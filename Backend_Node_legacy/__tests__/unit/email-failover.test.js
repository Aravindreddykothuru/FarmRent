/**
 * Failover between providers.
 *
 * One provider will always be having a bad day: a socket that never answers, a relay that refuses the message,
 * an API returning 500. What must not happen is that the message dies with it — the next provider in the chain
 * takes it, and only when every one of them has refused is the send reported as failed.
 *
 * MSG91 is an API that sends templates built in its panel, not the markup this codebase renders, so a message
 * with no template id is declined by it and picked up by SMTP. These tests hold that line too: a booking email
 * must not silently vanish because the provider in front of it cannot express it.
 */
// Each provider gets a short turn so a hang is cheap to test; the backstop around the whole chain sits well
// above it, because a chain cut short by its own backstop would never reach the fallback — which is the
// behaviour under test.
process.env.EMAIL_PROVIDER_TIMEOUT_MS = '300';
process.env.EMAIL_SEND_TIMEOUT_MS = '5000';

const mockSendMail = jest.fn(async () => ({ messageId: '<smtp>' }));
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
    createTestAccount: jest.fn(async () => ({ user: 'unit@ethereal.test', pass: 'unit' })),
    getTestMessageUrl: jest.fn(() => 'https://ethereal.email/message/unit'),
}));

const emailService = require('../../lib/emailService');

const SMTP_ENV = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'farmrent@example.test',
    SMTP_PASS: 'abcd efgh ijkl mnop',
    EMAIL_FROM: 'FarmRent <farmrent@example.test>',
};
const MSG91_ENV = {
    MSG91_AUTH_KEY: 'unit-auth-key',
    MSG91_DOMAIN: 'mail.example.test',
    MSG91_FROM_EMAIL: 'noreply@mail.example.test',
};

const saved = {};
const ALL_KEYS = [...Object.keys(SMTP_ENV), ...Object.keys(MSG91_ENV), 'EMAIL_PROVIDERS', 'EMAIL_PROVIDER', 'NODE_ENV'];

/** The last MSG91 request body, so the wire format can be asserted rather than assumed. */
let msg91Requests = [];

beforeEach(() => {
    for (const key of ALL_KEYS) saved[key] = process.env[key];
    Object.assign(process.env, SMTP_ENV, MSG91_ENV);
    process.env.EMAIL_PROVIDERS = 'smtp,msg91';
    process.env.NODE_ENV = 'production'; // no dev fallbacks may rescue a failing chain
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({ messageId: '<smtp>' });
    msg91Requests = [];
    global.fetch = jest.fn(async (url, init) => {
        msg91Requests.push({ url, headers: init.headers, body: JSON.parse(init.body), dispatcher: init.dispatcher });
        return { ok: true, status: 200, text: async () => '{"message":"success"}' };
    });
});

afterEach(() => {
    for (const key of ALL_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
    delete global.fetch;
});

const templated = (overrides = {}) => ({
    to: 'farmer@example.test',
    subject: '🔐 Reset your FarmRent password',
    html: '<p>reset</p>',
    template: { id: 'reset_tpl', variables: { NAME: 'Suresh', LINK: 'https://farmrent.test/r/abc' } },
    ...overrides,
});

describe('provider failover', () => {
    test('the primary sends and the fallback is never called', async () => {
        await expect(emailService.sendNow(templated())).resolves.toBe(true);

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a primary that throws hands the message to the next provider', async () => {
        mockSendMail.mockRejectedValue(new Error('ECONNREFUSED smtp.example.test:587'));

        await expect(emailService.sendNow(templated())).resolves.toBe(true);

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const sent = msg91Requests[0];
        expect(sent.url).toBe('https://control.msg91.com/api/v5/email/send');
        expect(sent.headers.authkey).toBe('unit-auth-key');
        expect(sent.body).toMatchObject({
            domain: 'mail.example.test',
            template_id: 'reset_tpl',
            from: { email: 'noreply@mail.example.test' },
            recipients: [{ to: [{ email: 'farmer@example.test' }], variables: { NAME: 'Suresh' } }],
        });
    });

    test('a primary that hangs is abandoned and the fallback still delivers', async () => {
        mockSendMail.mockImplementation(() => new Promise(() => {})); // never settles

        await expect(emailService.sendNow(templated())).resolves.toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    }, 30000);

    test('a fallback answering non-2xx is a failure, not a success', async () => {
        mockSendMail.mockRejectedValue(new Error('relay refused'));
        global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => '{"message":"bad template"}' }));

        await expect(emailService.sendNow(templated())).resolves.toBe(false);
    });

    test('order is honoured: msg91 first means smtp is the fallback', async () => {
        process.env.EMAIL_PROVIDERS = 'msg91,smtp';

        await expect(emailService.sendNow(templated())).resolves.toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('a message MSG91 cannot express falls through to SMTP instead of vanishing', async () => {
        process.env.EMAIL_PROVIDERS = 'msg91,smtp';

        // A booking confirmation: rendered HTML, no MSG91 template exists for it.
        await expect(emailService.sendNow(templated({ template: undefined, subject: 'Booking confirmed' }))).resolves.toBe(true);

        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    test('MSG91 alone counts as a real provider, so dev fallbacks stay off', async () => {
        for (const key of Object.keys(SMTP_ENV)) delete process.env[key];

        expect(emailService.hasRealProvider()).toBe(true);
        await expect(emailService.sendNow(templated())).resolves.toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('SMTP connects over IPv4, so a host without an IPv6 route can still send', async () => {
        const nodemailer = require('nodemailer');
        nodemailer.createTransport.mockClear();

        await expect(emailService.sendNow(templated({ template: undefined }))).resolves.toBe(true);

        // Without this the relay is reached at its IPv6 address and the connection fails with ENETUNREACH on
        // any host given no outbound IPv6 — which looks like the relay being down, not the network refusing.
        expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ family: 4 }));
    });

    test('MSG91 requests go over IPv4, so an IPv4 whitelist is what MSG91 checks', async () => {
        process.env.EMAIL_PROVIDERS = 'msg91,smtp';

        await expect(emailService.sendNow(templated())).resolves.toBe(true);

        // Left to itself Node prefers IPv6, and MSG91 then refuses a whitelisted key with apiError 418.
        const { dispatcher } = msg91Requests[0];
        expect(dispatcher).toBeDefined();
        expect(dispatcher.constructor.name).toBe('Agent');
    });

    test('when every provider refuses, the send reports failure', async () => {
        mockSendMail.mockRejectedValue(new Error('smtp down'));
        global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => 'upstream error' }));

        await expect(emailService.sendNow(templated())).resolves.toBe(false);
    });
});
