/**
 * The email queue must survive a send that never finishes.
 *
 * Nodemailer waits for ever by default, so a socket to a host that stopped answering used to hold the whole
 * in-memory drain: the message being sent never settled, and every message behind it waited with it. A
 * password reset queued behind such a send is, to the person waiting for it, simply an email that never came.
 * The drain is now bounded, and the flag it holds is released even if a send throws.
 */
process.env.EMAIL_SEND_TIMEOUT_MS = '300'; // read when the service is required, below
const devStore = require('../../lib/devEmailStore');

// One hanging send, then normal ones. The transport is the only thing faked; the queue is the real code.
// The names carry the mock prefix because jest.mock's factory may only reach variables named that way.
let mockHangNext = false;
const mockSendMail = jest.fn(async (message) => {
    if (mockHangNext) {
        mockHangNext = false;
        await new Promise(() => {}); // never settles, like a socket to a host that stopped answering
    }
    return { messageId: `<${message.subject}>` };
});

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
    createTestAccount: jest.fn(async () => ({ user: 'unit@ethereal.test', pass: 'unit' })),
    getTestMessageUrl: jest.fn(() => 'https://ethereal.email/message/unit'),
}));

const emailService = require('../../lib/emailService');

/** Waits until `predicate()` holds, or gives up — the queue drains on its own timers. */
async function waitFor(predicate, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
}

const captured = (subject) => devStore.getAll().some((e) => e.subject === subject);

describe('email queue', () => {
    beforeEach(() => {
        devStore.clear();
        mockSendMail.mockClear();
        mockHangNext = false;
    });

    test('a send that never finishes is abandoned, and the emails behind it still go out', async () => {
        mockHangNext = true;
        await emailService.send({ to: 'first@farmrent.test', subject: 'stalls for ever', html: '<p>one</p>' });
        expect(await waitFor(() => captured('stalls for ever'))).toBe(true);

        // The second message is queued behind a send that will never settle. Before the fix it stayed there.
        await emailService.send({ to: 'second@farmrent.test', subject: 'must still go out', html: '<p>two</p>' });
        expect(await waitFor(() => captured('must still go out'), 5000)).toBe(true);
        expect(mockSendMail).toHaveBeenCalledTimes(2);
    }, 45000);

    test('ordinary sends are delivered in order', async () => {
        await emailService.send({ to: 'a@farmrent.test', subject: 'first', html: '<p>a</p>' });
        await emailService.send({ to: 'b@farmrent.test', subject: 'second', html: '<p>b</p>' });

        expect(await waitFor(() => captured('first') && captured('second'))).toBe(true);
        expect(devStore.getAll().map((e) => e.subject)).toEqual(['second', 'first']); // newest first
    });

    test('an address-less message is refused rather than queued', async () => {
        await expect(emailService.send({ subject: 'nowhere', html: '<p>x</p>' })).resolves.toBe(false);
        expect(captured('nowhere')).toBe(false);
    });
});

describe('when a real provider is configured', () => {
    const saved = {};
    const SMTP_ENV = {
        SMTP_HOST: 'smtp.example.test',
        SMTP_USER: 'farmrent@example.test',
        SMTP_PASS: 'abcd efgh ijkl mnop',
        EMAIL_FROM: 'FarmRent <farmrent@example.test>',
    };

    beforeEach(() => {
        devStore.clear();
        mockSendMail.mockClear();
        for (const key of Object.keys(SMTP_ENV)) saved[key] = process.env[key];
        Object.assign(process.env, SMTP_ENV);
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    test('mail goes to the real provider and nothing is stashed in the dev inbox', async () => {
        expect(emailService.hasRealProvider()).toBe(true);

        await expect(emailService.sendNow({ to: 'someone@example.test', subject: 'real delivery', html: '<p>hi</p>' })).resolves.toBe(true);

        expect(mockSendMail).toHaveBeenCalledTimes(1);
        // The dev inbox must stay empty: with a provider configured it could otherwise be mistaken for delivery.
        expect(devStore.getAll()).toEqual([]);
    });

    test('a direct send reports failure instead of claiming the message was accepted', async () => {
        mockSendMail.mockRejectedValueOnce(new Error('550 mailbox unavailable'));

        await expect(emailService.sendNow({ to: 'someone@example.test', subject: 'refused', html: '<p>hi</p>' })).resolves.toBe(false);
    });
});
