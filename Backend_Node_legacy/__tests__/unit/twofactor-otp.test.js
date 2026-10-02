/**
 * The 2Factor SMS OTP client.
 *
 * Two things here are worth a test more than the happy path. The first is that the API key travels in the
 * URL path, which makes it one careless log line away from a support ticket — so these assert that nothing
 * the module logs contains it. The second is that 2Factor reports failure in prose: the code must not come
 * to depend on that wording, so anything it does not recognise has to fail closed as a wrong code rather
 * than fall through as a pass.
 */

jest.mock('../../lib/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const logger = require('../../lib/logger');
const twoFactor = require('../../lib/twoFactorService');

const KEY = 'test-api-key-9f2b';
const PHONE = '9876543210';

/** Makes global.fetch answer once with this JSON body, and records the URL it was called with. */
function mockFetchJson(body, { ok = true } = {}) {
    const calls = [];
    global.fetch = jest.fn((url) => {
        calls.push(String(url));
        return Promise.resolve({ ok, text: () => Promise.resolve(JSON.stringify(body)) });
    });
    return calls;
}

/** Every string that reached the logger in this test, flattened. */
function loggedText() {
    return [logger.info, logger.warn, logger.error, logger.debug]
        .flatMap((fn) => fn.mock.calls)
        .map((args) => JSON.stringify(args))
        .join(' ');
}

beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWOFACTOR_API_KEY = KEY;
    delete process.env.TWOFACTOR_TEMPLATE;
});

afterEach(() => {
    delete process.env.TWOFACTOR_API_KEY;
    delete process.env.TWOFACTOR_TEMPLATE;
    delete global.fetch;
});

describe('configuration', () => {
    test('reports itself unconfigured without an API key, so the caller can fall back', () => {
        delete process.env.TWOFACTOR_API_KEY;
        expect(twoFactor.isConfigured()).toBe(false);
        process.env.TWOFACTOR_API_KEY = KEY;
        expect(twoFactor.isConfigured()).toBe(true);
    });

    test('the template name is read per call, so a DLT template replaces the default with no code change', async () => {
        const calls = mockFetchJson({ Status: 'Success', Details: 'sess-1' });
        await twoFactor.sendOtp(PHONE);
        expect(calls[0]).toContain('/AUTOGEN');
        expect(calls[0].endsWith('/AUTOGEN')).toBe(true);

        process.env.TWOFACTOR_TEMPLATE = 'FarmRent OTP';
        const withTemplate = mockFetchJson({ Status: 'Success', Details: 'sess-2' });
        await twoFactor.sendOtp(PHONE);
        expect(withTemplate[0]).toContain('/AUTOGEN/FarmRent%20OTP');
    });
});

describe('masking', () => {
    test('a logged number keeps only its first and last two digits', () => {
        expect(twoFactor.maskPhone('9876543210')).toBe('98XXXXXX10');
    });

    test('anything that is not a 10-digit number is masked whole rather than part-revealed', () => {
        expect(twoFactor.maskPhone('')).toBe('**********');
        expect(twoFactor.maskPhone(undefined)).toBe('**********');
        expect(twoFactor.maskPhone('12345')).toBe('**********');
    });
});

describe('sending', () => {
    test('a success returns the session id and calls the AUTOGEN endpoint for +91', async () => {
        const calls = mockFetchJson({ Status: 'Success', Details: '5D6EBEE6-EC04-4776-846D' });

        const result = await twoFactor.sendOtp(PHONE);

        expect(result).toEqual({ ok: true, sessionId: '5D6EBEE6-EC04-4776-846D' });
        expect(calls[0]).toBe(`https://2factor.in/API/V1/${KEY}/SMS/+91${PHONE}/AUTOGEN`);
    });

    test('a refusal is reported as provider_rejected and logged loudly enough to alert someone', async () => {
        mockFetchJson({ Status: 'Error', Details: 'Insufficient balance' });

        const result = await twoFactor.sendOtp(PHONE);

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('provider_rejected');
        // Balance and template problems need a human, so they must not be filed as warnings.
        expect(logger.error).toHaveBeenCalled();
    });

    test('an unreachable provider is provider_down, not a rejection', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ETIMEDOUT')));

        const result = await twoFactor.sendOtp(PHONE);

        expect(result).toEqual({ ok: false, reason: 'provider_down' });
    });

    test('nothing logged on a send contains the API key', async () => {
        mockFetchJson({ Status: 'Success', Details: 'sess' });
        await twoFactor.sendOtp(PHONE);
        expect(loggedText()).not.toContain(KEY);

        jest.clearAllMocks();
        mockFetchJson({ Status: 'Error', Details: 'Invalid API Key' });
        await twoFactor.sendOtp(PHONE);
        expect(loggedText()).not.toContain(KEY);
    });

    test('a logged send never carries the full number', async () => {
        mockFetchJson({ Status: 'Success', Details: 'sess' });
        await twoFactor.sendOtp(PHONE);
        expect(loggedText()).not.toContain(PHONE);
        expect(loggedText()).toContain('98XXXXXX10');
    });
});

describe('verifying', () => {
    test('only Status Success counts as verified, and VERIFY3 is keyed on the number', async () => {
        const calls = mockFetchJson({ Status: 'Success', Details: 'OTP Matched' });

        const result = await twoFactor.verifyOtp(PHONE, '123456');

        expect(result).toEqual({ ok: true });
        expect(calls[0]).toBe(`https://2factor.in/API/V1/${KEY}/SMS/VERIFY3/+91${PHONE}/123456`);
    });

    test('a wrong code is a mismatch', async () => {
        mockFetchJson({ Status: 'Error', Details: 'OTP Mismatch' });
        await expect(twoFactor.verifyOtp(PHONE, '000000')).resolves.toEqual({ ok: false, reason: 'mismatch' });
    });

    test('an expired code is told apart from a wrong one, because the user is told different things', async () => {
        mockFetchJson({ Status: 'Error', Details: 'OTP Expired' });
        await expect(twoFactor.verifyOtp(PHONE, '123456')).resolves.toEqual({ ok: false, reason: 'expired' });
    });

    test('wording the client does not recognise fails closed as a mismatch', async () => {
        // 2Factor's exact strings are not an API and have changed before. Anything unrecognised must deny.
        mockFetchJson({ Status: 'Error', Details: 'Some wording nobody has seen before' });
        await expect(twoFactor.verifyOtp(PHONE, '123456')).resolves.toEqual({ ok: false, reason: 'mismatch' });

        mockFetchJson({ Status: 'Error' });
        await expect(twoFactor.verifyOtp(PHONE, '123456')).resolves.toEqual({ ok: false, reason: 'mismatch' });
    });

    test('an unreadable body is an outage, not a silent pass', async () => {
        // An HTML error page from a proxy must never be mistaken for a verified code.
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, text: () => Promise.resolve('<html>502</html>') }));

        await expect(twoFactor.verifyOtp(PHONE, '123456')).resolves.toEqual({ ok: false, reason: 'provider_down' });
    });

    test('an unreachable provider on verify is provider_down', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
        await expect(twoFactor.verifyOtp(PHONE, '123456')).resolves.toEqual({ ok: false, reason: 'provider_down' });
    });

    test('nothing logged on a failed verify contains the API key or the submitted code', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
        await twoFactor.verifyOtp(PHONE, '424242');
        const text = loggedText();
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('424242');
    });
});
