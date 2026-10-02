/**
 * A production process that refuses to start must say what is wrong with the environment.
 *
 * It used to refuse in silence. The validation failure was handed to the logger, which in production buffered
 * it into a file inside the container, and the process then called process.exit — discarding the buffer and
 * tripping the logger's own exit handler on the way out. What reached the deploy log was a stack trace from
 * inside sonic-boom, naming no setting and suggesting a bug in the logging library. A real deploy failed this
 * way, and the cause (an unset variable) took far longer to find than it should have.
 *
 * These tests run the real module in a child process, because the behaviour under test is the exit itself.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.join(__dirname, '..', '..');

/** Loads lib/config in a fresh production process, returning its exit code and stderr. */
function bootWith(env) {
    try {
        execFileSync(process.execPath, ['-e', "require('./lib/config')"], {
            cwd: BACKEND,
            encoding: 'utf8',
            // A clean slate: the parent's own environment must not stand in for what the container is given.
            env: { PATH: process.env.PATH, NODE_ENV: 'production', ...env },
        });
        return { code: 0, stderr: '' };
    } catch (err) {
        return { code: err.status, stderr: `${err.stderr || ''}${err.stdout || ''}` };
    }
}

const COMPLETE = {
    PORT: '3000',
    JWT_SECRET: 'a-secret-long-enough-to-pass',
    JWT_REFRESH_SECRET: 'another-secret-long-enough',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-key',
};

describe('startup configuration', () => {
    test('an unset variable is named on stderr, and the process exits non-zero', () => {
        const { code, stderr } = bootWith({ ...COMPLETE, JWT_SECRET: undefined });

        expect(code).toBe(1);
        expect(stderr).toContain('JWT_SECRET');
        // The old failure mode: a crash inside the logger, with the actual cause nowhere in sight.
        expect(stderr).not.toContain('sonic boom');
    });

    test('every invalid setting is reported, not just the first', () => {
        const { stderr } = bootWith({ ...COMPLETE, SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_KEY: undefined });

        expect(stderr).toContain('SUPABASE_URL');
        expect(stderr).toContain('SUPABASE_SERVICE_KEY');
    });

    test('the report carries field names and messages, never the values behind them', () => {
        const secret = 'sk-live-must-never-be-printed';
        const { stderr } = bootWith({ ...COMPLETE, SUPABASE_SERVICE_KEY: secret, SUPABASE_URL: 'not-a-url' });

        // A configuration dump is the easy way to write this feature and the easy way to leak a key into a
        // deploy log, which on a hosted platform is retained and widely readable.
        expect(stderr).not.toContain(secret);
        expect(stderr).toContain('SUPABASE_URL');
    });

    test('a complete environment starts without complaint', () => {
        const { code, stderr } = bootWith(COMPLETE);

        expect(code).toBe(0);
        expect(stderr).not.toContain('cannot start');
    });

    test('REDIS_URL is optional: the queue degrades, the process still starts', () => {
        // The Key Value store is added after the service is first deployed, so the app has to survive without it.
        const { code } = bootWith({ ...COMPLETE, REDIS_URL: undefined });

        expect(code).toBe(0);
    });
});

describe('production logging', () => {
    test('logs go to stdout, where the platform collects them', () => {
        const stdout = execFileSync(
            process.execPath,
            ['-e', "require('./lib/logger').info('startup-probe', { deploy: 'render' })"],
            { cwd: BACKEND, encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'production' } },
        );

        // Written to a file inside the container this line would be invisible — and lost with the container.
        expect(stdout).toContain('startup-probe');
        expect(JSON.parse(stdout.trim().split('\n').pop())).toMatchObject({ deploy: 'render' });
    });
});
