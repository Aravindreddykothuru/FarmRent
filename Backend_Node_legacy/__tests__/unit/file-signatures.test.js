const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
    detectMime,
    validateBufferMagicNumber,
    validateMagicNumber,
    ALLOWED_IMAGE_MIMES,
    ALLOWED_DOCUMENT_MIMES,
} = require('../../middleware/validateFileType');

const samples = {
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    'image/gif': Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1'),
    'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')]),
    'application/pdf': Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1'),
};

// ASF (Windows Media) header GUID: the container format behind the file-type parser advisory.
const asfHeader = Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex');

describe('upload file signatures', () => {
    test.each(Object.entries(samples))('recognises %s', (mime, bytes) => {
        expect(detectMime(bytes)).toBe(mime);
    });

    test('images are accepted where images are allowed; a PDF only where documents are', async () => {
        for (const mime of ALLOWED_IMAGE_MIMES) {
            await expect(validateBufferMagicNumber(samples[mime], ALLOWED_IMAGE_MIMES)).resolves.toBe(true);
        }
        await expect(validateBufferMagicNumber(samples['application/pdf'], ALLOWED_IMAGE_MIMES)).resolves.toBe(false);
        await expect(validateBufferMagicNumber(samples['application/pdf'], ALLOWED_DOCUMENT_MIMES)).resolves.toBe(true);
    });

    test('unknown, truncated or disguised content is refused', async () => {
        const refused = [
            asfHeader,
            crypto.randomBytes(64),
            Buffer.from('MZ\x90\x00 executable', 'latin1'),
            Buffer.from([0x89, 0x50, 0x4e]), // cut-off PNG
            Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'latin1'), // RIFF, but audio
            Buffer.alloc(0),
        ];
        for (const bytes of refused) {
            await expect(validateBufferMagicNumber(bytes, ALLOWED_DOCUMENT_MIMES)).resolves.toBe(false);
        }
        await expect(validateBufferMagicNumber('not a buffer', ALLOWED_DOCUMENT_MIMES)).resolves.toBe(false);
    });

    test('a stored upload is kept when valid and deleted when not', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farmrent-upload-'));
        const good = path.join(dir, 'id.png');
        const bad = path.join(dir, 'id.pdf');
        fs.writeFileSync(good, samples['image/png']);
        fs.writeFileSync(bad, asfHeader);
        try {
            await expect(validateMagicNumber(good, ALLOWED_DOCUMENT_MIMES)).resolves.toBe(true);
            expect(fs.existsSync(good)).toBe(true);
            await expect(validateMagicNumber(bad, ALLOWED_DOCUMENT_MIMES)).resolves.toBe(false);
            expect(fs.existsSync(bad)).toBe(false);
            await expect(validateMagicNumber(path.join(dir, 'missing.png'), ALLOWED_DOCUMENT_MIMES)).resolves.toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
