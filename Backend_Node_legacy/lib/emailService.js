/**
 * emailService.js — Multi-provider email delivery for FarmRent
 *
 * EMAIL_PROVIDERS sets the chain, primary first — for example "smtp,msg91" tries Gmail and falls through to
 * MSG91 when it fails, times out or refuses. Providers that are not fully configured are skipped rather than
 * tried, and each message is attempted down the chain until one accepts it. The older EMAIL_PROVIDER names only
 * a primary and is still honoured.
 *
 * Providers:
 *   brevo     BREVO_SMTP_USER + BREVO_SMTP_PASS + BREVO_SENDER_EMAIL      (SMTP, takes rendered HTML)
 *   smtp      SMTP_HOST + SMTP_USER + SMTP_PASS + EMAIL_FROM              (SMTP, takes rendered HTML)
 *   msg91     MSG91_AUTH_KEY + MSG91_DOMAIN + MSG91_FROM_EMAIL            (API, templates only — see below)
 *   resend    RESEND_API_KEY                        (skipped on the sandbox sender unless a domain is verified)
 *   ethereal  dev fallback — a fake inbox, never used when a real provider is configured or in production
 *
 * MSG91 sends templates built in its panel, not markup: a message reaches it only if it carries a template id
 * (see sendPasswordResetEmail), and anything else is declined so the next provider takes it. That means the
 * reset email exists twice — as HTML here and as a template there — and the two must be kept in step.
 *
 * ── Gmail SMTP ───────────────────────────────────────────────────────────────
 *   1. myaccount.google.com → Security → 2-Step Verification (enable)
 *   2. myaccount.google.com → Security → App passwords → Other → "FarmRent"
 *   3. Add to .env:
 *        SMTP_HOST=smtp.gmail.com
 *        SMTP_PORT=587
 *        SMTP_USER=you@gmail.com
 *        SMTP_PASS=xxxx xxxx xxxx xxxx   ← 16-char app password (no spaces)
 *        EMAIL_FROM=FarmRent <you@gmail.com>
 */

const logger = require('./logger');
const devStore = require('./devEmailStore');

let nodemailer;
try {
    nodemailer = require('nodemailer');
} catch {
    /* optional */
}

function normalizeSmtpPassword(raw) {
    return String(raw || '').replace(/\s/g, '');
}

function getSmtpCredentials() {
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = normalizeSmtpPassword(process.env.SMTP_PASS || process.env.EMAIL_PASS);
    const host = process.env.SMTP_HOST;
    if (!host || !user || !pass) return null;
    return {
        host,
        port: Number(process.env.SMTP_PORT) || 587,
        user,
        pass,
    };
}

function getFromAddress() {
    return (
        process.env.BREVO_SENDER_EMAIL ||
        process.env.EMAIL_FROM ||
        (getSmtpCredentials()?.user ? `FarmRent <${getSmtpCredentials().user}>` : null)
    );
}

function isBrevoConfigured() {
    return Boolean(process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS && getFromAddress());
}

function isSmtpConfigured() {
    return Boolean(getSmtpCredentials());
}

function shouldUseResend() {
    if (!process.env.RESEND_API_KEY) return false;
    const from = process.env.RESEND_FROM || 'FarmRent <onboarding@resend.dev>';
    // Resend sandbox only delivers to the account owner — skip to avoid slow 403 retries
    if (from.includes('resend.dev')) return false;
    return true;
}

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * True when a provider that can reach a real inbox is configured.
 *
 * Everything the developer conveniences below exist for — Ethereal's fake mailbox, the in-memory dev inbox, the
 * reset link handed straight back in the API response — is for a machine that has no such provider. None of
 * them may stand in for one that is configured, or "the email works" stops meaning anything.
 */
function hasRealProvider() {
    return isBrevoConfigured() || isSmtpConfigured() || isMsg91Configured() || shouldUseResend();
}

/**
 * The providers to try, in order, for one message.
 *
 * EMAIL_PROVIDERS names the chain outright — "smtp,msg91" means Gmail first and MSG91 when it fails. The older
 * EMAIL_PROVIDER named only a primary and left the rest to a hard-coded order; it is still honoured so existing
 * deployments keep working. Providers that are not fully configured are dropped rather than tried and failed,
 * so a half-filled block costs nothing.
 */
function providerOrder() {
    const all = {
        brevo: sendViaBrevo,
        smtp: sendViaSmtp,
        msg91: sendViaMsg91,
        resend: sendViaResend,
        ethereal: sendViaEthereal,
    };
    const DEFAULT_ORDER = ['brevo', 'smtp', 'msg91', 'resend'];

    const listed = String(process.env.EMAIL_PROVIDERS || '')
        .split(',')
        .map((n) => n.trim().toLowerCase())
        .filter((n) => all[n]);

    let chain;
    if (listed.length) {
        // Anything the list leaves out still trails behind it: a provider that is configured is worth trying
        // before giving up entirely.
        chain = [...listed, ...DEFAULT_ORDER.filter((n) => !listed.includes(n))];
    } else {
        const preferred = (process.env.EMAIL_PROVIDER || 'brevo').toLowerCase();
        chain = all[preferred] ? [preferred, ...DEFAULT_ORDER.filter((n) => n !== preferred)] : DEFAULT_ORDER;
    }
    chain.push('ethereal');

    return chain
        .map((name) => all[name])
        .filter((fn) => {
            if (fn === sendViaResend) return shouldUseResend();
            if (fn === sendViaBrevo) return isBrevoConfigured();
            if (fn === sendViaSmtp) return isSmtpConfigured();
            if (fn === sendViaMsg91) return isMsg91Configured();
            // Ethereal is a fake mailbox only a developer can read. It is a last resort where nothing real is
            // configured — never a silent substitute for a provider that is, and never in production.
            if (fn === sendViaEthereal) return !isProduction() && !hasRealProvider();
            return true;
        });
}

// ── Provider: Resend ─────────────────────────────────────────────────────────

async function sendViaResend({ to, subject, html, attachments }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return false;

    const from = process.env.RESEND_FROM || 'FarmRent <onboarding@resend.dev>';

    try {
        const bodyPayload = { from, to, subject, html };
        if (attachments && attachments.length > 0) {
            bodyPayload.attachments = attachments.map((att) => ({
                filename: att.filename,
                content: att.content, // expects base64 string
            }));
        }

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            logger.warn('[email/resend] Send failed', { status: res.status, err });
            return false;
        }
        logger.info('[email/resend] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/resend] Network error', { error: e.message });
        return false;
    }
}

// No mail call may hang. Nodemailer waits for ever by default, and a socket that never answers used to leave
// the queue's drain flag set — after which every later email sat in an array nobody drained, while callers
// were told the message had been accepted.
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

// Every SMTP transport is built from this. The IPv4 pin is the same lesson MSG91 taught, arriving by a
// different route: Node resolves a relay to its IPv6 address first, and a host with no IPv6 route out answers
// with ENETUNREACH before a packet leaves. Gmail's relay is dual-stack, so on such a host — one cloud provider
// gives its containers no outbound IPv6 at all — every message failed at connect with
// "ENETUNREACH 2607:f8b0:...:587", which reads as the relay being down rather than as the network refusing.
// Every relay this code talks to is reachable over IPv4, so preferring it costs nothing and removes the class.
const SMTP_TRANSPORT = { ...SMTP_TIMEOUTS, family: 4 };
// Overridable so tests can drive the backstop in milliseconds instead of waiting out the real bound.
const MEMORY_SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS) || 30_000;
// How long any one provider gets before the chain moves on. Above socketTimeout, so a provider's own error is
// what normally ends its turn; this only catches a call that fails to settle at all.
const PROVIDER_TIMEOUT_MS = Number(process.env.EMAIL_PROVIDER_TIMEOUT_MS) || 25_000;

/** Rejects if `promise` has not settled within `ms`, so one stalled network call cannot block the queue. */
function withTimeout(promise, ms, what) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

// ── Provider: Brevo SMTP (free 300/day, no domain verification needed) ────────

async function sendViaBrevo({ to, subject, html, attachments }) {
    if (!nodemailer) return false;
    const { BREVO_SMTP_USER, BREVO_SMTP_PASS } = process.env;
    if (!BREVO_SMTP_USER || !BREVO_SMTP_PASS) return false;

    const senderEmail = getFromAddress();
    if (!senderEmail || senderEmail.includes('resend.dev') || senderEmail.includes('smtp-brevo.com')) {
        logger.warn('[email/brevo] No valid sender email configured. Set BREVO_SENDER_EMAIL or EMAIL_FROM in .env');
        return false;
    }

    try {
        const transporter = nodemailer.createTransport({
            host: 'smtp-relay.brevo.com',
            port: 587,
            secure: false,
            auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_PASS },
            ...SMTP_TRANSPORT,
        });
        await transporter.sendMail({ from: senderEmail, to, subject, html, attachments });
        logger.info('[email/brevo] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/brevo] Send failed', { error: e.message });
        return false;
    }
}

// ── Provider: Nodemailer / SMTP ───────────────────────────────────────────────

function buildSmtpTransport() {
    if (!nodemailer) return null;
    const creds = getSmtpCredentials();
    if (!creds) return null;
    return nodemailer.createTransport({
        host: creds.host,
        port: creds.port,
        secure: creds.port === 465,
        auth: { user: creds.user, pass: creds.pass },
        ...SMTP_TRANSPORT,
    });
}

async function sendViaSmtp({ to, subject, html, attachments }) {
    const transporter = buildSmtpTransport();
    if (!transporter) return false;

    const from = getFromAddress() || getSmtpCredentials()?.user;
    try {
        await transporter.sendMail({ from, to, subject, html, attachments });
        logger.info('[email/smtp] Sent', { to, subject });
        return true;
    } catch (e) {
        logger.warn('[email/smtp] Send failed', { error: e.message });
        return false;
    }
}

// ── Provider: MSG91 ──────────────────────────────────────────────────────────
//
// MSG91's email API sends templates, not markup: the body carries a template_id and variables, and the content
// itself lives in the MSG91 panel. It therefore cannot send the HTML this file renders. A message that names no
// template is declined here and picked up by the next provider in the chain, which is what keeps booking mail,
// invoices and OTPs working while only the templated ones go through MSG91.
//
// Contract: POST https://control.msg91.com/api/v5/email/send, authkey header, body
// { recipients: [{ to: [{name, email}], variables }], from: {name, email}, domain, template_id }.

const MSG91_ENDPOINT = 'https://control.msg91.com/api/v5/email/send';

function isMsg91Configured() {
    return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_DOMAIN && process.env.MSG91_FROM_EMAIL);
}

// MSG91 whitelists callers by IPv4 address, but its API also answers over IPv6 and Node tries IPv6 first whenever
// the machine has it. On such a network every request arrives from an IPv6 address — often a temporary one that
// changes every few hours — so a correctly whitelisted key is refused (401, apiError 418) whatever IPv4 is listed.
// Pinning these requests to IPv4 makes the whitelist mean what it says. Only MSG91 is affected; nothing else
// the application connects to changes.
let msg91Ipv4Agent = null;
function msg91Dispatcher() {
    if (!msg91Ipv4Agent) {
        const { Agent } = require('undici');
        msg91Ipv4Agent = new Agent({ connect: { family: 4 } });
    }
    return msg91Ipv4Agent;
}

async function sendViaMsg91({ to, subject, template }) {
    if (!isMsg91Configured()) return false;

    const templateId = template?.id;
    if (!templateId) {
        logger.info('[email/msg91] Skipped — this message has no MSG91 template', { subject });
        return false;
    }

    const name = String(to).split('@')[0];
    const body = {
        recipients: [{ to: [{ name, email: to }], ...(template.variables ? { variables: template.variables } : {}) }],
        from: { name: process.env.MSG91_FROM_NAME || 'FarmRent', email: process.env.MSG91_FROM_EMAIL },
        domain: process.env.MSG91_DOMAIN,
        template_id: templateId,
    };

    // fetch has no timeout of its own, so the same bound the SMTP transports carry is applied here by hand.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SMTP_TIMEOUTS.socketTimeout);
    try {
        const res = await fetch(MSG91_ENDPOINT, {
            method: 'POST',
            headers: { authkey: process.env.MSG91_AUTH_KEY, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
            dispatcher: msg91Dispatcher(),
        });
        const text = await res.text();
        if (!res.ok) {
            logger.warn('[email/msg91] Send failed', { to, subject, status: res.status, body: text.slice(0, 300) });
            return false;
        }
        logger.info('[email/msg91] Sent', { to, subject, templateId });
        return true;
    } catch (e) {
        const reason = e.name === 'AbortError' ? `no response within ${SMTP_TIMEOUTS.socketTimeout}ms` : e.message;
        logger.warn('[email/msg91] Send failed', { to, subject, error: reason });
        return false;
    } finally {
        clearTimeout(timer);
    }
}

// ── Provider: Ethereal (auto-generated test account, clickable preview URL) ───

let _etherealAccount = null;

async function getEtherealAccount() {
    if (_etherealAccount) return _etherealAccount;
    if (!nodemailer) return null;
    try {
        // Creating a test account is a network call like any other, and it runs before the first dev email.
        _etherealAccount = await withTimeout(nodemailer.createTestAccount(), 10_000, 'ethereal account creation');
        return _etherealAccount;
    } catch {
        return null;
    }
}

async function sendViaEthereal({ to, subject, html, attachments }) {
    if (!nodemailer) return false;
    const account = await getEtherealAccount();
    if (!account) return false;

    try {
        const transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: { user: account.user, pass: account.pass },
            ...SMTP_TRANSPORT,
        });

        const info = await transporter.sendMail({
            from: 'FarmRent <farmrent@ethereal.email>',
            to,
            subject,
            html,
            attachments,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        const divider = '═'.repeat(65);
        logger.warn(
            `\n${divider}\n` +
                `📧  DEV EMAIL PREVIEW — open this URL in your browser:\n\n` +
                `  ➜  ${previewUrl}\n\n` +
                `  To:      ${to}\n` +
                `  Subject: ${subject}\n` +
                `${divider}`,
        );
        return true;
    } catch (e) {
        logger.warn('[email/ethereal] Failed', { error: e.message });
        return false;
    }
}

// The chain reports which provider accepted a message, so the name travels with the function.
sendViaResend.providerName = 'resend';
sendViaBrevo.providerName = 'brevo';
sendViaSmtp.providerName = 'smtp';
sendViaMsg91.providerName = 'msg91';
sendViaEthereal.providerName = 'ethereal';

// ── Unified send (queued via BullMQ with memory fallback) ─────────────────────

const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const hasRedisUrl = !!redisUrl;

let connection = null;
let emailQueue = null;
let emailWorker = null;

async function sendActual({ to, subject, html, attachments, template }) {
    if (!to) return false;

    // The dev inbox is for machines with no real provider. Where one is configured the message goes to the real
    // mailbox and nothing is stashed locally, so /api/dev/emails can never be mistaken for proof of delivery.
    if (!isProduction() && !hasRealProvider()) devStore.store({ to, subject, html, attachments });

    const failures = [];
    for (const provider of providerOrder()) {
        const name = provider.providerName || provider.name;
        try {
            // Bounded per provider, not once around the whole chain: a provider that hangs must cost its own
            // turn and nothing more, or the fallback never gets one and having two providers buys nothing.
            // Set above the socket timeout so a provider's own error surfaces first and reads better in the log.
            const accepted = await withTimeout(
                Promise.resolve(provider({ to, subject, html, attachments, template })),
                PROVIDER_TIMEOUT_MS,
                `${name} send to ${to}`,
            );
            if (accepted) {
                if (failures.length) logger.warn('[email] Delivered by a fallback provider', { to, subject, via: name, failures });
                return true;
            }
            failures.push(name);
        } catch (err) {
            // A provider that throws — a timeout, a refused connection, a DNS failure — must not take the rest of
            // the chain down with it. That is the whole point of having more than one.
            failures.push(`${name} (${err.message})`);
            logger.warn('[email] Provider failed; trying the next one', { to, subject, provider: name, error: err.message });
        }
    }

    logger.error('[email] All providers failed', { to, subject, from: getFromAddress(), tried: failures });
    return false;
}

async function checkRedisVersion(client, serviceName) {
    try {
        if (!client) return false;
        const info = await client.info();
        const match = info.match(/redis_version:([0-9.]+)/);
        if (match) {
            const version = match[1];
            const major = parseInt(version.split('.')[0], 10);
            if (major < 5) {
                logger.warn(`[Startup] ${serviceName}: Redis version ${version} is < 5.0.0. Disabling background queues.`);
                return false;
            }
        }
        return true;
    } catch (err) {
        logger.warn(`[Startup] ${serviceName}: Failed to verify Redis version:`, { error: err.message });
        return false;
    }
}

if (isDev && !hasRedisUrl) {
    // Queues disabled, handled gracefully in send() fallback
} else {
    const targetUrl = redisUrl || 'redis://127.0.0.1:6379';
    let everConnected = false;
    let loggedRedisDown = false;

    try {
        connection = new IORedis(targetUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            // `times` counts attempts since the last successful connection. Give up only when Redis was never
            // reachable at start-up; once connected, keep reconnecting through outages with capped backoff.
            retryStrategy(times) {
                if (!everConnected && times >= 5) {
                    if (!loggedRedisDown) {
                        logger.warn('[email-queue] Redis is unreachable after maximum attempts. Background email queue disabled.');
                        loggedRedisDown = true;
                    }
                    return null;
                }
                return Math.min(times * 200, 3000);
            },
        });
        connection.once('ready', () => {
            everConnected = true;
        });

        connection.on('ready', async () => {
            if (emailQueue) return;

            const versionOk = await checkRedisVersion(connection, 'email-queue');
            if (!versionOk) {
                if (connection) {
                    connection.removeAllListeners();
                    try {
                        connection.disconnect();
                    } catch (_) {
                        /* socket already closed — nothing left to release */
                    }
                    connection = null;
                }
                return;
            }

            emailQueue = new Queue('emails', {
                connection,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: true,
                    removeOnFail: 100,
                },
            });

            emailWorker = new Worker(
                'emails',
                async (job) => {
                    const { to, subject, html, attachments, template } = job.data;
                    const success = await sendActual({ to, subject, html, attachments, template });
                    if (!success) throw new Error('Email sending failed across all providers');
                },
                {
                    connection,
                    concurrency: 2,
                },
            );

            emailWorker.on('failed', (job, err) => {
                const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
                const errKey = `email:${err.message}`;
                if (!loggedErrors.has(errKey)) {
                    logger.error(`[email-queue] Job ${job?.id} failed: ${err.message}`);
                    loggedErrors.add(errKey);
                }
            });

            process.once('SIGTERM', () => emailWorker.close().catch(() => {}));
            process.once('SIGINT', () => emailWorker.close().catch(() => {}));
        });

        connection.on('error', (err) => {
            if (!loggedRedisDown) {
                logger.warn('[email-queue] Redis connection error:', { error: err.message });
            }
        });
    } catch (err) {
        logger.warn('[email-queue] Redis initialization failed:', { error: err.message });
    }
}

// Memory fallback queue if Redis is down
const memoryEmailQueue = [];
let isProcessingMemoryEmails = false;

function triggerMemoryEmailWorker() {
    if (isProcessingMemoryEmails) return;
    isProcessingMemoryEmails = true;
    processNextMemoryEmail().catch((err) => {
        // The drain must never die still holding the flag: that is what silently disables email for the rest
        // of the process's life, with every caller still being told delivery was accepted.
        isProcessingMemoryEmails = false;
        logger.error('[email-queue] Memory email worker stopped unexpectedly', { error: err.message });
    });
}

async function processNextMemoryEmail() {
    const task = memoryEmailQueue.shift();
    if (!task) {
        isProcessingMemoryEmails = false;
        return;
    }
    try {
        // Bounded twice over: each provider has its own socket timeouts, and this is the backstop for anything
        // that still fails to settle. One stalled send must not cost every later email.
        await withTimeout(sendActual(task), MEMORY_SEND_TIMEOUT_MS, `email to ${task.to}`);
    } catch (err) {
        logger.error('[email-queue] Memory email sending failed:', { to: task.to, subject: task.subject, error: err.message });
    } finally {
        setImmediate(processNextMemoryEmail);
    }
}

async function send({ to, subject, html, attachments, template }) {
    if (!to) return false;

    // Convert Buffers to Base64 strings for Redis/JSON queue compatibility
    const serializableAttachments = attachments?.map((att) => {
        let content = att.content;
        let encoding = att.encoding;
        if (Buffer.isBuffer(att.content)) {
            content = att.content.toString('base64');
            encoding = 'base64';
        }
        return {
            filename: att.filename,
            contentType: att.contentType,
            content,
            encoding,
        };
    });

    if (emailQueue && connection && connection.status === 'ready') {
        try {
            await emailQueue.add('send', { to, subject, html, attachments: serializableAttachments, template });
            return true;
        } catch (err) {
            logger.error('[email-queue] BullMQ add failed, falling back to memory queue:', { error: err.message });
            memoryEmailQueue.push({ to, subject, html, attachments: serializableAttachments, template });
            triggerMemoryEmailWorker();
            return true;
        }
    } else {
        // Fallback to local memory queue
        memoryEmailQueue.push({ to, subject, html, attachments: serializableAttachments, template });
        triggerMemoryEmailWorker();
        return true;
    }
}

/**
 * Sends without the queue and reports what actually happened.
 *
 * A queued send can only ever report "accepted", which is no use to a caller that has to tell someone their
 * reset link is on the way — or refuse the request when it is not. Mail whose outcome the caller must know
 * goes through here; everything else can be queued.
 */
async function sendNow({ to, subject, html, attachments, template }) {
    if (!to) return false;
    try {
        return await withTimeout(sendActual({ to, subject, html, attachments, template }), MEMORY_SEND_TIMEOUT_MS, `email to ${to}`);
    } catch (err) {
        logger.error('[email] Direct send failed', { to, subject, error: err.message });
        return false;
    }
}

// ── Email templates ───────────────────────────────────────────────────────────

const base = (content) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#166534;padding:24px 32px;">
    <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">🌾 FarmRent</span>
  </div>
  <div style="padding:32px;">${content}</div>
  <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
    <p style="color:#9ca3af;font-size:12px;margin:0;">
      You received this email because you have a FarmRent account.
      If you did not request this, you can safely ignore it.
    </p>
  </div>
</div>`;

const btn = (href, text, color = '#166534') =>
    `<div style="text-align:center;margin:32px 0;">
       <a href="${href}" style="background:${color};color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
         ${text}
       </a>
     </div>`;

async function sendVerificationEmail(userEmail, { userName, link }) {
    return send({
        to: userEmail,
        subject: '✅ Verify your FarmRent email address',
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Verify Your Email</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Welcome to FarmRent! Click the button below to verify your email address and activate your account.</p>
          ${btn(link, 'Verify My Email')}
          <p style="color:#6b7280;font-size:13px;">This link expires in <strong>24 hours</strong>.</p>
          <p style="color:#6b7280;font-size:13px;">Or copy this link into your browser:<br>
            <a href="${link}" style="color:#166534;word-break:break-all;">${link}</a>
          </p>`),
    });
}

async function sendPasswordResetEmail(userEmail, { userName, link }) {
    // Sent directly rather than queued, so the caller learns whether it really went out and can refuse the
    // request instead of telling someone to check an inbox nothing was sent to.
    return sendNow({
        to: userEmail,
        subject: '🔐 Reset your FarmRent password',
        // MSG91 can only send templates, so the reset carries the id of the one built in its panel along with
        // the values it fills in. Providers that take markup use the html below and ignore this.
        template: process.env.MSG91_RESET_TEMPLATE_ID
            ? { id: process.env.MSG91_RESET_TEMPLATE_ID, variables: { NAME: userName, LINK: link } }
            : undefined,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Reset Your Password</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">
            We received a request to reset your FarmRent password.
            Click the button below to create a new password.
          </p>
          ${btn(link, 'Reset My Password', '#dc2626')}
          <p style="color:#6b7280;font-size:13px;">
            This link expires in <strong>1 hour</strong>.
            If you did not request a password reset, no action is needed — your password will not change.
          </p>
          <p style="color:#6b7280;font-size:13px;">Or copy this link into your browser:<br>
            <a href="${link}" style="color:#dc2626;word-break:break-all;">${link}</a>
          </p>`),
    });
}

async function sendBookingConfirmation(userEmail, { userName, equipmentName, startDate, endDate, totalAmount, bookingId }) {
    await send({
        to: userEmail,
        subject: `✅ Booking Confirmed — ${equipmentName}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Booking Confirmed 🎉</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your booking for <strong>${equipmentName}</strong> has been confirmed.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Rental Period</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">${startDate} → ${endDate}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Total Amount</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">₹${totalAmount}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px;">Thank you for using FarmRent!</p>`),
    });
}

async function sendPaymentReceipt(userEmail, { userName, equipmentName, amountPaid, paymentId, bookingId }) {
    await send({
        to: userEmail,
        subject: `💰 Payment Receipt — ₹${amountPaid}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Payment Successful</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your payment for <strong>${equipmentName}</strong> has been received.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Amount Paid</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">₹${amountPaid}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Payment ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${paymentId}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#6b7280;font-size:13px;">Keep this email as your receipt.</p>`),
    });
}

async function sendCancellationEmail(userEmail, { userName, equipmentName, bookingId, refundAmount }) {
    const refundHtml = refundAmount
        ? `<p style="color:#374151;">A refund of <strong>₹${refundAmount}</strong> has been initiated and will reflect in 5–7 business days.</p>`
        : '';
    await send({
        to: userEmail,
        subject: `🚫 Booking Cancelled — ${equipmentName}`,
        html: base(`
          <h2 style="color:#dc2626;margin-top:0;">Booking Cancelled</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">Your booking for <strong>${equipmentName}</strong> (ID: <code>${bookingId}</code>) has been cancelled.</p>
          ${refundHtml}
          <p style="color:#6b7280;font-size:13px;">If you have questions, contact FarmRent support.</p>`),
    });
}

async function sendNewBookingRequestToOwner(ownerEmail, { ownerName, farmerName, equipmentName, startDate, endDate, bookingId }) {
    await send({
        to: ownerEmail,
        subject: `📋 New Booking Request — ${equipmentName}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">New Booking Request</h2>
          <p style="color:#374151;">Hi <strong>${ownerName}</strong>,</p>
          <p style="color:#374151;"><strong>${farmerName}</strong> wants to rent your <strong>${equipmentName}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Rental Period</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-weight:600;">${startDate} → ${endDate}</td></tr>
            <tr><td style="padding:10px;border:1px solid #e5e7eb;color:#6b7280;">Booking ID</td>
                <td style="padding:10px;border:1px solid #e5e7eb;font-size:12px;">${bookingId}</td></tr>
          </table>
          <p style="color:#374151;">Log in to your FarmRent dashboard to accept or reject this request.</p>`),
    });
}

async function sendInvoiceEmail(userEmail, { userName, bookingId, pdfBuffer }) {
    return send({
        to: userEmail,
        subject: `🌾 FarmRent Invoice — Booking FR-${String(bookingId).slice(0, 8).toUpperCase()}`,
        html: base(`
          <h2 style="color:#111827;margin-top:0;">Invoice Available</h2>
          <p style="color:#374151;">Hi <strong>${userName}</strong>,</p>
          <p style="color:#374151;">The invoice for your FarmRent booking <strong>FR-${String(bookingId).slice(0, 8).toUpperCase()}</strong> has been generated.</p>
          <p style="color:#374151;">We have attached the PDF invoice to this email for your records.</p>
          <p style="color:#6b7280;font-size:13px;">Thank you for using FarmRent!</p>`),
        attachments: [
            {
                filename: `invoice-${String(bookingId).slice(0, 8)}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
            },
        ],
    });
}

module.exports = {
    send,
    sendNow,
    hasRealProvider,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendBookingConfirmation,
    sendPaymentReceipt,
    sendCancellationEmail,
    sendNewBookingRequestToOwner,
    sendInvoiceEmail,
};
