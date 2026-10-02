/**
 * twoFactorService.js — SMS OTP for Indian mobile numbers, via 2Factor.in
 *
 * 2Factor's AUTOGEN flow generates the code, sends it and checks it. This process never sees the OTP,
 * which is the point: there is nothing here to store, leak or log. A send returns a session id kept only
 * for tracing, and the check is keyed on the phone number (VERIFY3) rather than that session, so a user
 * can request the code on one request and confirm it on another.
 *
 * Configuration:
 *   TWOFACTOR_API_KEY   the account key. Without it this module reports itself unconfigured and the
 *                       caller falls back to the existing OTP providers; the key is never logged or
 *                       returned to a client.
 *   TWOFACTOR_TEMPLATE  the DLT template name. 2Factor's default template is used when unset, so a
 *                       registered "FarmRent" template can replace it with no code change.
 *
 * Every failure is reported as a reason code rather than a provider string, so callers can phrase their
 * own messages and none of 2Factor's wording reaches a user.
 */

const logger = require('./logger');

const BASE_URL = 'https://2factor.in/API/V1';
const REQUEST_TIMEOUT_MS = 10_000;

const apiKey = () => process.env.TWOFACTOR_API_KEY || '';
const template = () => process.env.TWOFACTOR_TEMPLATE || '';

/** True when an API key is present. Callers fall back to another provider when it is not. */
function isConfigured() {
    return apiKey().length > 0;
}

/**
 * 98XXXXXX21 — enough to recognise your own number in a log line, not enough to be one.
 * Anything that is not a 10-digit number is masked whole rather than partly revealed.
 */
function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length !== 10) return '**********';
    return `${digits.slice(0, 2)}XXXXXX${digits.slice(-2)}`;
}

/**
 * GETs a 2Factor endpoint and returns its parsed body.
 *
 * The path carries the API key, so nothing here logs a URL. A non-JSON body means the provider answered
 * with something unexpected (an HTML error page, say), which is treated as an outage rather than parsed.
 */
async function call(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${BASE_URL}/${path}`, { signal: controller.signal });
        const text = await res.text();
        try {
            return { body: JSON.parse(text), httpOk: res.ok };
        } catch {
            return { body: null, httpOk: false };
        }
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Asks 2Factor to generate and send a code.
 * @returns {Promise<{ok: true, sessionId: string} | {ok: false, reason: 'provider_down'|'provider_rejected', detail?: string}>}
 */
async function sendOtp(phone) {
    const masked = maskPhone(phone);
    const suffix = template() ? `/${encodeURIComponent(template())}` : '';

    let result;
    try {
        result = await call(`${encodeURIComponent(apiKey())}/SMS/+91${phone}/AUTOGEN${suffix}`);
    } catch (e) {
        // A timeout or a DNS failure: the provider, not the request, is at fault.
        logger.error('[2factor] send unreachable — OTP delivery is down', { phone: masked, error: e.message });
        return { ok: false, reason: 'provider_down' };
    }

    const { body } = result;
    if (body?.Status === 'Success') {
        logger.info('[2factor] OTP sent', { phone: masked, sessionId: body.Details });
        return { ok: true, sessionId: String(body.Details || '') };
    }

    // A rejection is usually an exhausted balance or a template that is not approved. Both need a human,
    // so this is logged at error level to raise an alert rather than disappearing into warnings.
    const detail = typeof body?.Details === 'string' ? body.Details : 'unknown';
    logger.error('[2factor] send refused — check balance and template approval', { phone: masked, detail });
    return { ok: false, reason: 'provider_rejected', detail };
}

/**
 * Checks a code with 2Factor.
 *
 * Only `Status === "Success"` counts as verified. 2Factor's exact failure wording is not treated as an
 * API: the body is inspected only to tell an expired code from a wrong one, and anything unrecognised is
 * reported as a mismatch, which is the safe way to be wrong.
 *
 * @returns {Promise<{ok: true} | {ok: false, reason: 'mismatch'|'expired'|'provider_down'}>}
 */
async function verifyOtp(phone, otp) {
    const masked = maskPhone(phone);

    let result;
    try {
        result = await call(`${encodeURIComponent(apiKey())}/SMS/VERIFY3/+91${phone}/${encodeURIComponent(otp)}`);
    } catch (e) {
        logger.error('[2factor] verify unreachable', { phone: masked, error: e.message });
        return { ok: false, reason: 'provider_down' };
    }

    const { body } = result;
    if (body?.Status === 'Success') return { ok: true };
    if (body === null) {
        logger.error('[2factor] verify returned an unreadable body', { phone: masked });
        return { ok: false, reason: 'provider_down' };
    }

    const detail = String(body?.Details ?? '').toLowerCase();
    if (detail.includes('expire')) return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'mismatch' };
}

module.exports = { isConfigured, maskPhone, sendOtp, verifyOtp };
