#!/usr/bin/env node
/**
 * Browser smoke test for the FarmRent web app.
 *
 * Opens every page in real Chrome as an anonymous visitor, a renter, an owner and an admin, and fails on
 * console errors, uncaught exceptions, failed or 5xx same-origin requests, framework error pages, empty
 * renders and wrong auth redirects. It also drives the core rental journey through the UI (request → accept →
 * hand over → return → complete with the renter's code), checks phone-width pages for horizontal overflow and
 * signs out through the navbar.
 *
 * Usage:  node scripts/ui-smoke.mjs [--base-url http://localhost:3000] [--chrome <path>] [--headed]
 * Needs:  a non-production server and the seeded demo accounts (Backend_Node_legacy: npm run seed).
 *         Chrome/Chromium/Edge is found automatically; set CHROME_PATH or --chrome to override.
 */
/* global process, console, URL, fetch, document, window, localStorage -- Node script; page callbacks run in the browser */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = option('--base-url', process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ORIGIN = new URL(BASE_URL).origin;
const PASSWORD = process.env.SEED_PASSWORD || 'FarmRent@2026';
const ACCOUNTS = {
    renter: 'farmer1@farmrent.local',
    owner: 'owner2@farmrent.local',
    admin: 'admin@farmrent.local',
    driver: 'driver1@farmrent.local',
};
const OWNER_EQUIPMENT = '5b6d8c1e-0001-4a3b-9c2d-000000000005'; // seeded, owned by owner2
const OTHER_EQUIPMENT = '5b6d8c1e-0001-4a3b-9c2d-000000000001'; // seeded, owned by owner1
const NAV_TIMEOUT = 120_000; // the first request for a page compiles it when the server runs in dev mode
const SETTLE_MS = 1_500;     // effects that fetch or redirect after hydration

const results = [];

function record(name, issues, note) {
    results.push({ name, ok: issues.length === 0 });
    console.log(`${issues.length ? 'FAIL' : 'PASS'}  ${name}${note ? `  (${note})` : ''}`);
    for (const issue of issues) console.log(`        ${issue}`);
}

function findChrome() {
    return [
        option('--chrome'),
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].find((p) => p && existsSync(p));
}

const sameOrigin = (url) => {
    try { return new URL(url).origin === ORIGIN; } catch { return false; }
};

/** Collects everything a user's browser would flag while a page is open. */
function monitor(page) {
    const issues = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const url = msg.location()?.url || '';
        const text = msg.text();
        // Third-party resources (map tiles, stock photos) depend on the network, not on this app.
        if (/^Failed to load resource/.test(text) && url && !sameOrigin(url)) return;
        issues.push(`console error: ${text.slice(0, 300)}${url ? ` @ ${url}` : ''}`);
    });
    page.on('pageerror', (err) => issues.push(`uncaught exception: ${err.message.split('\n')[0].slice(0, 300)}`));
    page.on('response', (res) => {
        if (res.status() >= 500 && sameOrigin(res.url())) issues.push(`HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText || '';
        if (!sameOrigin(req.url()) || failure.includes('ERR_ABORTED')) return;
        issues.push(`request failed: ${req.method()} ${req.url()} ${failure}`);
    });
    return { take: () => issues.splice(0) };
}

async function newActor(browser, { mobile = false, storageState, seedLanguage = true } = {}) {
    const context = await browser.newContext({
        storageState,
        ...(mobile
            ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
            : { viewport: { width: 1366, height: 900 } }),
    });
    if (seedLanguage) {
        // A returning visitor who already picked English: keeps the first-launch language modal out of the way.
        await context.addInitScript(() => {
            try {
                localStorage.setItem('farmrent_lang', 'en');
                localStorage.setItem('farmrent_lang_chosen', '1');
            } catch { /* storage unavailable */ }
        });
    }
    const page = await context.newPage();
    return { context, page, mon: monitor(page) };
}

async function gotoSettled(page, path) {
    const response = await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => { /* sockets keep the network busy */ });
    await page.waitForTimeout(SETTLE_MS);
    return response;
}

/** Loads a page and checks where it ends up and what the browser reported on the way. */
async function visit(actor, path, { expectPath, allowPaths = [], expectNext = false, checkOverflow = false, label } = {}) {
    const { page, mon } = actor;
    const requestedPath = path.split('?')[0];
    const accepted = [expectPath || requestedPath, ...allowPaths];
    const issues = [];
    let response;
    try {
        response = await gotoSettled(page, path);
    } catch (err) {
        issues.push(`navigation failed: ${err.message.split('\n')[0]}`);
    }
    const finalUrl = new URL(page.url());
    if (!accepted.includes(finalUrl.pathname)) {
        issues.push(`ended on ${finalUrl.pathname}${finalUrl.search} (expected ${accepted.join(' or ')})`);
    }
    if (expectNext && finalUrl.searchParams.get('next') !== requestedPath) {
        issues.push(`login redirect lost the return path (next=${finalUrl.searchParams.get('next')})`);
    }
    if (response && response.status() >= 400) issues.push(`document HTTP ${response.status()}`);
    const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    if (/Unhandled Runtime Error|Application error: a client-side exception|This page could not be found|Internal Server Error/i.test(body)) {
        issues.push('framework error page rendered');
    } else if (body.trim().length < 20) {
        issues.push('page rendered no visible content');
    }
    if (checkOverflow) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
        if (overflow > 1) issues.push(`horizontal overflow of ${overflow}px at ${page.viewportSize()?.width}px width`);
    }
    issues.push(...mon.take());
    record(label || path, issues, finalUrl.pathname !== requestedPath ? `→ ${finalUrl.pathname}` : undefined);
}

/** Runs a UI interaction; returns false when it could not complete so dependent steps can be skipped. */
async function step(actor, name, fn) {
    const issues = [];
    let note;
    let completed = true;
    try {
        note = await fn();
    } catch (err) {
        completed = false;
        issues.push(err.message.split('\n')[0]);
    }
    issues.push(...actor.mon.take());
    record(name, issues, note);
    return completed;
}

async function clickAndWait(page, locator, methods, pathname) {
    const [res] = await Promise.all([
        page.waitForResponse((r) => methods.includes(r.request().method()) && new URL(r.url()).pathname === pathname, { timeout: 30_000 }),
        locator.click({ timeout: 30_000 }),
    ]);
    if (res.status() >= 400) throw new Error(`${res.request().method()} ${pathname} returned ${res.status()}: ${(await res.text()).slice(0, 200)}`);
    return res;
}

async function uiLogin(actor, email, expectPath) {
    const { page } = actor;
    const ok = await step(actor, `Sign in through the login form as ${email}`, async () => {
        await gotoSettled(page, '/login');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD);
        await Promise.all([
            page.waitForURL((url) => url.pathname === expectPath, { timeout: NAV_TIMEOUT }),
            page.locator('button[type="submit"]').click(),
        ]);
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
        return `→ ${expectPath}`;
    });
    if (!ok) throw new Error(`could not sign in as ${email}`);
}

function futureDate(offsetDays) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
}

async function section(name, fn) {
    try {
        await fn();
    } catch (err) {
        record(`${name}: remaining checks skipped`, [err.message.split('\n')[0]]);
    }
}

async function main() {
    const health = await fetch(`${BASE_URL}/api/v1/health`).catch(() => null);
    if (!health?.ok) {
        console.error(`Server not reachable at ${BASE_URL}`);
        process.exit(1);
    }

    const executablePath = findChrome();
    const browser = await chromium.launch({
        executablePath,
        channel: executablePath ? undefined : 'chrome',
        headless: !args.includes('--headed'),
    });
    console.log(`FarmRent UI smoke against ${BASE_URL} (${executablePath || 'chrome channel'})\n`);

    const actors = [];
    const actor = async (opts) => {
        const a = await newActor(browser, opts);
        actors.push(a);
        return a;
    };

    try {
        await section('Anonymous visitor', async () => {
            const firstVisit = await actor({ seedLanguage: false });
            await visit(firstVisit, '/', { label: '/ (first launch, language chooser)' });

            const anon = await actor();
            // The dev email inbox exists only when the server runs in development mode.
            const devInbox = (await fetch(`${BASE_URL}/api/dev/emails`).catch(() => null))?.ok ? ['/dev/emails'] : [];
            for (const path of ['/', '/browse', '/how-it-works', '/login', '/register', '/forgot-password', '/reset-password',
                '/verify-email', '/select-language', '/docs/gps-setup', `/equipment/${OTHER_EQUIPMENT}`, ...devInbox]) {
                await visit(anon, path);
            }
            // Legacy URL kept for old bookmarks; it forwards to the current page.
            await visit(anon, '/password-reset', { expectPath: '/forgot-password', label: '/password-reset (legacy → /forgot-password)' });
            for (const path of ['/dashboard', '/dashboard/farmer', '/dashboard/owner', '/dashboard/admin', '/dashboard/profile',
                '/bookings', `/book/${OTHER_EQUIPMENT}`, '/offers', '/chats', '/disputes', '/wishlist', '/add-equipment',
                '/payment/success', '/driver', '/analytics', '/wallet', '/notifications', '/kyc']) {
                await visit(anon, path, { expectPath: '/login', expectNext: true, label: `${path} (signed out → login)` });
            }

            const { page, mon } = anon;
            const missing = await page.goto(`${BASE_URL}/no-such-page`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
            await page.waitForTimeout(SETTLE_MS);
            // The browser logs the 404 document itself; anything beyond that is a real error.
            const extra = mon.take().filter((i) => !/status of 404/.test(i));
            if (missing?.status() !== 404) extra.push(`expected HTTP 404, got ${missing?.status()}`);
            record('/no-such-page renders the not-found page', extra);
        });

        let bookingId;
        const renter = await actor();
        const owner = await actor();

        await section('Rental journey through the UI', async () => {
            await uiLogin(renter, ACCOUNTS.renter, '/dashboard/farmer');
            await uiLogin(owner, ACCOUNTS.owner, '/dashboard/owner');

            const offset = 120 + Math.floor(Math.random() * 200);
            const start = futureDate(offset);
            const end = futureDate(offset + 1);
            let otp;

            const requested = await step(renter, 'Renter requests a booking (cash on delivery)', async () => {
                const { page } = renter;
                await gotoSettled(page, `/book/${OWNER_EQUIPMENT}`);
                await page.locator('#start-date').fill(start);
                await page.locator('#end-date').fill(end);
                const total = page.getByTestId('quote-total');
                await total.waitFor({ timeout: 30_000 });
                const quoted = (await total.textContent())?.trim();
                await page.getByRole('button', { name: /Cash on Delivery/ }).click();
                await clickAndWait(page, page.getByRole('button', { name: /Request Booking/ }), ['POST'], '/api/v1/bookings');
                await Promise.all([
                    page.waitForURL((url) => url.pathname === '/payment/success', { timeout: NAV_TIMEOUT }),
                    page.getByRole('button', { name: /Pay on Delivery/ }).click({ timeout: 30_000 }),
                ]);
                bookingId = new URL(page.url()).searchParams.get('bookingId');
                if (!bookingId) throw new Error('confirmation page has no bookingId');
                // Exact match: the "Booking request sent!" toast from the booking page may still be on screen.
                await page.getByText('Booking Request Sent', { exact: true }).waitFor({ timeout: 30_000 });
                return `booking ${bookingId}, ${start} → ${end}, quoted ${quoted}`;
            });
            if (!requested) throw new Error('booking request failed');

            const accepted = await step(owner, 'Owner accepts the request on the booking page', async () => {
                await gotoSettled(owner.page, `/bookings/${bookingId}`);
                await clickAndWait(owner.page, owner.page.getByRole('button', { name: 'Accept', exact: true }), ['PATCH'], `/api/v1/bookings/${bookingId}/accept`);
            });
            if (!accepted) throw new Error('accept failed');

            const started = await step(owner, 'Owner hands over the equipment', async () => {
                await clickAndWait(owner.page, owner.page.getByRole('button', { name: /Hand Over Equipment/ }), ['PATCH'], `/api/v1/bookings/${bookingId}/start`);
            });
            if (!started) throw new Error('hand-over failed');

            // Live location during the rental: the owner's phone broadcasts over the app's authenticated socket and
            // the renter's tracking page shows it. No browser talks to the database directly.
            const tracked = await step(renter, "Owner shares live location; the renter's tracking page shows it", async () => {
                const where = { latitude: 16.30712, longitude: 80.44118 };
                await owner.context.grantPermissions(['geolocation'], { origin: ORIGIN });
                await owner.context.setGeolocation({ ...where, accuracy: 6 });

                await gotoSettled(renter.page, `/dashboard/track/${bookingId}`);
                await gotoSettled(owner.page, `/dashboard/track/${bookingId}`);
                await owner.page.getByRole('button', { name: /Start Broadcasting Location/ }).click({ timeout: 30_000 });
                await owner.page.getByTestId('points-sent').filter({ hasText: /^[1-9]\d*$/ }).waitFor({ timeout: 30_000 });

                const expected = `${where.latitude.toFixed(5)}, ${where.longitude.toFixed(5)}`;
                const position = renter.page.getByTestId('live-position');
                await position.filter({ hasText: expected }).waitFor({ timeout: 30_000 });
                owner.mon.take(); // the owner's page is checked by its own visit later
                return `renter sees ${expected}`;
            });
            if (!tracked) throw new Error('live tracking failed');

            const returned = await step(renter, 'Renter returns the equipment and sees the completion code', async () => {
                const { page } = renter;
                await gotoSettled(page, `/bookings/${bookingId}`);
                await clickAndWait(page, page.getByRole('button', { name: /Returning the Equipment/ }), ['POST'], `/api/v1/bookings/${bookingId}/return`);
                const code = page.getByTestId('completion-otp');
                await code.waitFor({ timeout: 30_000 });
                otp = (await code.textContent())?.trim();
                if (!/^\d{6}$/.test(otp || '')) throw new Error(`unexpected completion code "${otp}"`);
            });
            if (!returned) throw new Error('return failed');

            const completed = await step(owner, "Owner completes the rental with the renter's code", async () => {
                const { page } = owner;
                await gotoSettled(page, `/bookings/${bookingId}`);
                await page.getByRole('button', { name: /Complete Rental/ }).click({ timeout: 30_000 });
                await page.getByLabel('Completion code').fill(otp);
                await clickAndWait(page, page.getByRole('button', { name: 'Confirm Complete', exact: true }), ['POST', 'PATCH'], `/api/v1/bookings/${bookingId}/complete`);
                const res = await renter.page.request.get(`${BASE_URL}/api/v1/bookings/${bookingId}`);
                const status = (await res.json())?.data?.status;
                if (status !== 'completed') throw new Error(`renter sees status ${status}`);
                return 'renter sees completed';
            });
            if (!completed) throw new Error('completion failed');
        });

        await section('Renter pages', async () => {
            if (!renter.page.url().startsWith(BASE_URL)) await uiLogin(renter, ACCOUNTS.renter, '/dashboard/farmer');
            const pages = ['/dashboard', '/dashboard/farmer', '/dashboard/profile', '/dashboard/kyc', '/bookings', '/offers', '/chats',
                '/disputes', '/wishlist', '/notifications', '/wallet', '/kyc', '/browse', `/equipment/${OTHER_EQUIPMENT}`,
                `/book/${OTHER_EQUIPMENT}`];
            for (const path of pages) await visit(renter, path, path === '/dashboard' ? { allowPaths: ['/dashboard/farmer'] } : {});
            if (bookingId) {
                for (const path of [`/bookings/${bookingId}`, `/tracking/${bookingId}`, `/dashboard/track/${bookingId}`,
                    `/dashboard/bookings/${bookingId}/location-history`]) {
                    await visit(renter, path);
                }
                await visit(renter, `/payment/success?method=cod&bookingId=${bookingId}`);
            }
            await visit(renter, '/login', { expectPath: '/dashboard/farmer', label: '/login (signed in → dashboard)' });
            await visit(renter, '/dashboard/admin', { expectPath: '/dashboard/farmer', label: '/dashboard/admin (renter → own dashboard)' });
        });

        await section('Owner pages', async () => {
            for (const path of ['/dashboard/owner', '/add-equipment', `/edit-equipment/${OWNER_EQUIPMENT}`, '/analytics', '/offers', '/chats']) {
                await visit(owner, path);
            }
            if (bookingId) await visit(owner, `/bookings/${bookingId}`);
            await visit(owner, '/dashboard/driver/register');
            await visit(owner, '/dashboard/driver', { allowPaths: ['/dashboard/driver/register'] });
            await visit(owner, '/driver', { allowPaths: ['/dashboard/driver/register'] });
        });

        await section('Driver pages', async () => {
            const driver = await actor();
            await uiLogin(driver, ACCOUNTS.driver, '/dashboard/driver');
            await visit(driver, '/dashboard/driver');
            await step(driver, 'Driver dashboard lists the vehicle and toggles availability through the API', async () => {
                const { page } = driver;
                await page.getByText('AP07TD4412').waitFor({ timeout: 30_000 });
                await clickAndWait(page, page.getByRole('button', { name: /Online|Offline/i }), ['PATCH'], '/api/v1/drivers/availability');
                return 'vehicle listed; availability toggled';
            });
        });

        await section('Admin pages', async () => {
            const admin = await actor();
            await uiLogin(admin, ACCOUNTS.admin, '/dashboard/admin');
            await visit(admin, '/dashboard/admin');
            await visit(admin, '/dashboard', { allowPaths: ['/dashboard/admin'] });
        });

        await section('Phone-width layout', async () => {
            const mobileAnon = await actor({ mobile: true });
            for (const path of ['/', '/browse', '/login', '/register', `/equipment/${OTHER_EQUIPMENT}`]) {
                await visit(mobileAnon, path, { checkOverflow: true, label: `${path} @390px` });
            }
            const mobileRenter = await actor({ mobile: true, storageState: await renter.context.storageState() });
            for (const path of ['/dashboard/farmer', '/bookings', `/book/${OTHER_EQUIPMENT}`]) {
                await visit(mobileRenter, path, { checkOverflow: true, label: `${path} @390px (renter)` });
            }
        });

        await section('Sign out', async () => {
            await step(renter, 'Renter signs out from the navbar; pages and API refuse the old session', async () => {
                const { page } = renter;
                await gotoSettled(page, '/dashboard/farmer');
                await page.getByRole('button', { name: 'User account menu' }).click();
                const logoutResponse = page
                    .waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/logout', { timeout: 30_000 })
                    .catch(() => null);
                await page.getByRole('menuitem', { name: /Sign Out/ }).click();
                const logout = await logoutResponse;
                try {
                    await page.waitForURL((url) => url.pathname === '/login', { timeout: 30_000 });
                } catch {
                    const left = (await renter.context.cookies()).filter((c) => ['token', 'rfsh', 'authRole'].includes(c.name));
                    const body = logout ? (await logout.text().catch(() => '')).slice(0, 160) : '';
                    throw new Error(`still on ${new URL(page.url()).pathname} after sign-out; logout API ${logout ? `HTTP ${logout.status()} ${body}` : 'never called'}; `
                        + `session cookies left: ${left.map((c) => c.name).join(', ') || 'none'}`);
                }
                const me = await page.request.get(`${BASE_URL}/api/v1/auth/me`);
                if (me.status() !== 401) throw new Error(`/auth/me after sign-out returned ${me.status()}`);
                await gotoSettled(page, '/bookings');
                const landed = new URL(page.url()).pathname;
                if (landed !== '/login') throw new Error(`/bookings after sign-out ended on ${landed}`);
                return '/auth/me → 401, /bookings → /login';
            });
        });
    } finally {
        await Promise.all(actors.map((a) => a.context.close().catch(() => {})));
        await browser.close();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
