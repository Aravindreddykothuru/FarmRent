/**
 * The address an upload returns is the address a browser will fetch.
 *
 * These are not the same address on every provider. Supabase accepts uploads at /storage/v1/s3 and serves the
 * file from /storage/v1/object/public/<bucket>; the code used to derive the second from the first, so an
 * upload reported success and handed back a URL that 404s. Nothing on the server ever sees that failure — it
 * happens in the browser of whoever opens the listing, and the photo is broken from then until someone looks.
 *
 * The module reads its configuration once at require time, so each case loads it in a fresh registry.
 */
const KEY = 'equipment/abc/photo.jpg';

/** Loads lib/s3Storage with the given environment, isolated from the rest of the suite. */
function loadWith(env) {
    let mod;
    jest.isolateModules(() => {
        const saved = {};
        const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_ENDPOINT', 'AWS_S3_PUBLIC_URL', 'AWS_S3_BUCKET', 'AWS_REGION', 'NODE_ENV'];
        for (const k of keys) saved[k] = process.env[k];
        for (const k of keys) delete process.env[k];
        Object.assign(process.env, env);
        try {
            mod = require('../../lib/s3Storage');
        } finally {
            for (const k of keys) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
        }
    });
    return mod;
}

// One logger object across every isolated registry, so what the module logs can be asserted. Spying on the
// real module does not work here: isolateModules re-requires it too, and the spy ends up watching an instance
// the code under test never calls. The name carries the mock prefix because jest.mock's factory may only
// reach variables named that way.
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../lib/logger', () => mockLogger);

// The upload itself is not under test here — where the file ends up being served from is.
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
    PutObjectCommand: jest.fn((args) => args),
    DeleteObjectCommand: jest.fn((args) => args),
    GetObjectCommand: jest.fn((args) => args),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn(async () => 'https://signed.example/x') }));

const SUPABASE = {
    AWS_ACCESS_KEY_ID: 'id',
    AWS_SECRET_ACCESS_KEY: 'secret',
    AWS_S3_BUCKET: 'farmrent-assets',
    AWS_S3_ENDPOINT: 'https://project.supabase.co/storage/v1/s3',
    AWS_S3_PUBLIC_URL: 'https://project.supabase.co/storage/v1/object/public/farmrent-assets',
};

describe('uploaded file URLs', () => {
    beforeEach(() => {
        for (const fn of Object.values(mockLogger)) fn.mockClear();
    });

    test('a Supabase upload is served from the public path, not the S3 endpoint', async () => {
        const s3 = loadWith(SUPABASE);

        const url = await s3.uploadToS3(KEY, Buffer.from('x'), 'image/jpeg');

        expect(url).toBe(`https://project.supabase.co/storage/v1/object/public/farmrent-assets/${KEY}`);
        // The endpoint accepts uploads; it does not serve them. A URL built from it 404s in the browser.
        expect(url).not.toContain('/storage/v1/s3');
    });

    test('a trailing slash on the configured base does not double up', async () => {
        const s3 = loadWith({ ...SUPABASE, AWS_S3_PUBLIC_URL: `${SUPABASE.AWS_S3_PUBLIC_URL}/` });

        expect(await s3.uploadToS3(KEY, Buffer.from('x'), 'image/jpeg')).not.toContain('//equipment');
    });

    test('plain AWS still gets its bucket URL when no public base is set', async () => {
        const s3 = loadWith({
            AWS_ACCESS_KEY_ID: 'id',
            AWS_SECRET_ACCESS_KEY: 'secret',
            AWS_S3_BUCKET: 'farmrent-assets',
            AWS_REGION: 'ap-south-1',
        });

        expect(await s3.uploadToS3(KEY, Buffer.from('x'), 'image/jpeg')).toBe(
            `https://farmrent-assets.s3.ap-south-1.amazonaws.com/${KEY}`,
        );
    });

    test('with no storage configured the placeholder is announced, not whispered', async () => {
        const s3 = loadWith({});
        const url = await s3.uploadToS3(KEY, Buffer.from('x'), 'image/jpeg');

        // The caller stores this as though it were a photo, so the log has to say it is not one.
        expect(url).toContain('mock-s3-storage.local');
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('placeholder'), expect.objectContaining({ key: KEY }));
    });

    test('a production process with no storage says so at error level', () => {
        loadWith({ NODE_ENV: 'production' });

        // Silence here is how a deployment serves broken photos for weeks without anyone noticing.
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('placeholder URL'));
    });
});
