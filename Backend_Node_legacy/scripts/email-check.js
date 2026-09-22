#!/usr/bin/env node
/**
 * Says which mail providers are configured, which of them actually answer, and — on request — sends one real
 * message through the application's own path.
 *
 *   FARMRENT_ENV_FILE=.env.production node scripts/email-check.js
 *   FARMRENT_ENV_FILE=.env.production node scripts/email-check.js --send you@example.com
 *
 * "Configured" means every field a provider needs is filled in; a half-filled provider is reported as such and
 * skipped, because a provider that is nearly set up is what makes mail appear to work while nothing arrives.
 * "Reachable" means the provider accepted the credentials — for SMTP an authenticated connection, for Resend a
 * key the API recognises. Neither proves a message reached an inbox; only --send and a look in the mailbox do.
 */
'use strict';

const path = require('path');

require('dotenv').config({
    path: process.env.FARMRENT_ENV_FILE ? path.resolve(process.env.FARMRENT_ENV_FILE) : path.join(__dirname, '..', '.env'),
});

const nodemailer = require('nodemailer');

const args = process.argv.slice(2);
const sendTo = args.includes('--send') ? args[args.indexOf('--send') + 1] : null;

const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };
const filled = (...keys) => keys.every((k) => String(process.env[k] || '').trim().length > 0);
const mask = (value) => (value ? `${String(value).slice(0, 2)}***` : '(empty)');

async function checkSmtp() {
    const name = 'SMTP';
    const needs = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
    if (!filled(...needs)) return { name, configured: false, missing: needs.filter((k) => !filled(k)) };

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS).replace(/\s/g, '') },
        ...TIMEOUTS,
    });
    try {
        await transporter.verify();
        return { name, configured: true, reachable: true, detail: `${process.env.SMTP_HOST} as ${process.env.SMTP_USER}` };
    } catch (err) {
        return { name, configured: true, reachable: false, detail: err.message };
    }
}

async function checkBrevo() {
    const name = 'Brevo';
    const needs = ['BREVO_SMTP_USER', 'BREVO_SMTP_PASS'];
    if (!filled(...needs)) return { name, configured: false, missing: needs.filter((k) => !filled(k)) };

    const sender = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_FROM;
    if (!sender) return { name, configured: false, missing: ['BREVO_SENDER_EMAIL or EMAIL_FROM'] };

    const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_PASS },
        ...TIMEOUTS,
    });
    try {
        await transporter.verify();
        return { name, configured: true, reachable: true, detail: `sender ${sender} (must be verified in Brevo)` };
    } catch (err) {
        return { name, configured: true, reachable: false, detail: err.message };
    }
}

async function checkMsg91() {
    const name = 'MSG91';
    const needs = ['MSG91_AUTH_KEY', 'MSG91_DOMAIN', 'MSG91_FROM_EMAIL'];
    if (!filled(...needs)) return { name, configured: false, missing: needs.filter((k) => !filled(k)) };

    // There is no credential-check endpoint, so a send is attempted with a deliberately absent template: the
    // key and domain are judged by whether MSG91 authenticates the request rather than by what it does with it.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        const res = await fetch('https://control.msg91.com/api/v5/email/send', {
            method: 'POST',
            headers: {
                authkey: process.env.MSG91_AUTH_KEY,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({
                recipients: [{ to: [{ name: 'check', email: process.env.MSG91_FROM_EMAIL }] }],
                from: { name: process.env.MSG91_FROM_NAME || 'FarmRent', email: process.env.MSG91_FROM_EMAIL },
                domain: process.env.MSG91_DOMAIN,
                // Never a real template: this is a credential check, and with a working template it would send.
                template_id: '',
            }),
            signal: controller.signal,
        });
        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
            // MSG91 turns API security on by default: a valid key called from an address missing from its whitelist
            // gets 401 with apiError 418, which reads exactly like a bad key unless the two are told apart.
            const ipBlocked = /"apiError"\s*:\s*"?418/.test(text);
            return {
                name,
                configured: true,
                reachable: false,
                detail: ipBlocked
                    ? 'key refused from this IP (apiError 418) — whitelist this machine in MSG91 → Authkey → Whitelisted IPs, or turn API security off'
                    : `authentication refused (${res.status}): ${text.slice(0, 200)}`,
            };
        }
        // With no template MSG91 answers 422 and lists what is missing. A complaint about the domain means it is not
        // verified for this account; complaints only about the template and body mean key and domain are both good.
        let errors = {};
        try {
            errors = JSON.parse(text).errors || {};
        } catch {
            /* not JSON: judged by the status alone */
        }
        if (errors.domain) {
            return { name, configured: true, reachable: false, detail: `domain not accepted: ${[].concat(errors.domain).join(' ')}` };
        }
        return {
            name,
            configured: true,
            reachable: true,
            detail: `key accepted, domain ${process.env.MSG91_DOMAIN} verified for this account`,
            warning: filled('MSG91_RESET_TEMPLATE_ID')
                ? null
                : 'MSG91_RESET_TEMPLATE_ID is unset — password resets will fall through to SMTP',
        };
    } catch (e) {
        const reason = e.name === 'AbortError' ? 'no response within 15s' : e.message;
        return { name, configured: true, reachable: false, detail: reason };
    } finally {
        clearTimeout(timer);
    }
}

async function checkResend() {
    const name = 'Resend';
    if (!filled('RESEND_API_KEY')) return { name, configured: false, missing: ['RESEND_API_KEY'] };

    const from = process.env.RESEND_FROM || process.env.EMAIL_FROM || '';
    try {
        const res = await fetch('https://api.resend.com/domains', {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        });
        if (!res.ok) return { name, configured: true, reachable: false, detail: `API answered ${res.status}` };

        const body = await res.json().catch(() => ({}));
        const domains = (body.data || []).map((d) => `${d.name} [${d.status}]`);
        const verified = (body.data || []).filter((d) => d.status === 'verified').map((d) => d.name);
        const sandbox = /resend\.dev/.test(from) || !from;
        return {
            name,
            configured: true,
            reachable: true,
            detail: domains.length ? `domains: ${domains.join(', ')}` : 'no domains added — sandbox only',
            warning: sandbox
                ? 'RESEND_FROM is unset or on resend.dev: the sandbox delivers only to the account owner'
                : verified.some((d) => from.includes(d))
                  ? null
                  : `RESEND_FROM (${from}) is not on a verified domain`,
        };
    } catch (err) {
        return { name, configured: true, reachable: false, detail: err.message };
    }
}

async function main() {
    console.log(`Mail configuration — ${process.env.FARMRENT_ENV_FILE || '.env'}\n`);
    console.log(`  EMAIL_PROVIDER (primary): ${process.env.EMAIL_PROVIDER || '(unset — defaults to brevo)'}`);
    console.log(`  EMAIL_FROM:               ${process.env.EMAIL_FROM || '(unset)'}`);
    console.log(`  SMTP_PASS:                ${mask(process.env.SMTP_PASS)}\n`);

    console.log(`  EMAIL_PROVIDERS (chain):  ${process.env.EMAIL_PROVIDERS || '(unset — falls back to EMAIL_PROVIDER)'}\n`);

    const results = [await checkSmtp(), await checkBrevo(), await checkMsg91(), await checkResend()];
    for (const r of results) {
        if (!r.configured) {
            console.log(`  ✗ ${r.name.padEnd(7)} not configured — missing ${r.missing.join(', ')}`);
            continue;
        }
        console.log(`  ${r.reachable ? '✓' : '✗'} ${r.name.padEnd(7)} ${r.reachable ? 'credentials accepted' : 'FAILED'} — ${r.detail}`);
        if (r.warning) console.log(`      warning: ${r.warning}`);
    }

    const usable = results.filter((r) => r.configured && r.reachable);
    console.log(
        `\n  ${usable.length} of ${results.length} providers usable${usable.length ? `: ${usable.map((r) => r.name).join(', ')}` : ''}`,
    );

    if (!sendTo) {
        console.log('\n  Add --send <address> to put a real message through the application path.');
        process.exit(usable.length ? 0 : 1);
    }

    // Through the application's own service, so this exercises what the API actually calls.
    const emailService = require('../lib/emailService');
    console.log(`\n  Sending a real password-reset email to ${sendTo} …`);
    const delivered = await emailService.sendPasswordResetEmail(sendTo, {
        userName: 'FarmRent',
        link: `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=email-check-${Date.now()}`,
    });
    console.log(`  sendPasswordResetEmail -> ${delivered}`);
    console.log(delivered ? '  Accepted by the provider. Check the mailbox (including spam).' : '  Not sent — see the errors above.');
    process.exit(delivered ? 0 : 1);
}

main().catch((err) => {
    console.error('email-check failed:', err.message);
    process.exit(1);
});
