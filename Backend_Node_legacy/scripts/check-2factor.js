#!/usr/bin/env node
/**
 * Checks a 2Factor account without sending an SMS.
 *
 * Reads TWOFACTOR_API_KEY and TWOFACTOR_TEMPLATE from the env file, asks 2Factor for the SMS balance,
 * and reports whether the key is accepted and whether there is credit to send with. Nothing here prints
 * the key, and no message is sent, so it is safe to run as often as you like while getting set up.
 *
 * Usage:  FARMRENT_ENV_FILE=.env.localstack node scripts/check-2factor.js
 *         node scripts/check-2factor.js            (reads .env)
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), process.env.FARMRENT_ENV_FILE || '.env') });

const key = process.env.TWOFACTOR_API_KEY || '';
const template = process.env.TWOFACTOR_TEMPLATE || '';

if (!key) {
    console.error('TWOFACTOR_API_KEY is not set in', process.env.FARMRENT_ENV_FILE || '.env');
    console.error('Add it, then run this again.');
    process.exit(1);
}

// Enough to confirm you pasted the right thing, not enough to be the thing.
const fingerprint = `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)`;

(async () => {
    console.log(`key:      ${fingerprint}`);
    console.log(`template: ${template || '(empty — 2Factor default template will be used)'}`);

    let res;
    try {
        res = await fetch(`https://2factor.in/API/V1/${encodeURIComponent(key)}/BAL/SMS`, {
            signal: AbortSignal.timeout(15_000),
        });
    } catch (e) {
        console.error(`\nCould not reach 2Factor: ${e.message}`);
        process.exit(2);
    }

    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        console.error(`\n2Factor answered with something that is not JSON (HTTP ${res.status}).`);
        console.error('That usually means the key is malformed and a proxy error page came back instead.');
        process.exit(2);
    }

    if (body.Status === 'Success') {
        const balance = Array.isArray(body.Details) ? body.Details[0] : body.Details;
        console.log(`\nKey accepted. SMS balance: ${balance}`);
        if (Number(balance) <= 0) {
            console.log('Balance is zero — sends will be refused until you top up.');
            process.exit(3);
        }
        console.log('Ready to send. Next: start the app and request a code for your own number.');
        process.exit(0);
    }

    console.error(`\n2Factor refused the key: ${body.Details ?? JSON.stringify(body)}`);
    console.error('Check you copied the whole X-API-Key from the control panel, with no stray spaces.');
    process.exit(2);
})();
