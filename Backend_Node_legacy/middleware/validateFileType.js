const fs = require('fs');

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_DOCUMENT_MIMES = new Set([...ALLOWED_IMAGE_MIMES, 'application/pdf']);

// Uploads only ever accept these formats, so a fixed signature check is enough. It reads a few leading bytes and
// cannot loop on malformed input, unlike a general-purpose container parser.
const SIGNATURES = [
    { mime: 'image/jpeg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    {
        mime: 'image/png',
        matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    { mime: 'image/gif', matches: (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.toString('latin1', 0, 6)) },
    {
        mime: 'image/webp',
        matches: (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
    },
    { mime: 'application/pdf', matches: (b) => b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-' },
];
const HEADER_BYTES = 12;

/** The MIME type the leading bytes identify, or null when they match none of the accepted formats. */
function detectMime(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    const match = SIGNATURES.find((s) => s.matches(buffer));
    return match ? match.mime : null;
}

async function validateMagicNumber(filePath, allowedMimes) {
    try {
        const handle = await fs.promises.open(filePath, 'r');
        let header;
        try {
            const buf = Buffer.alloc(HEADER_BYTES);
            const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
            header = buf.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
        if (allowedMimes.has(detectMime(header))) return true;
    } catch {
        /* unreadable file: treated as invalid below */
    }
    await fs.promises.unlink(filePath).catch(() => {
        /* already gone: nothing to clean up */
    });
    return false;
}

async function validateBufferMagicNumber(buffer, allowedMimes) {
    return allowedMimes.has(detectMime(buffer));
}

// Validates an array of multer file objects; deletes and returns false for any invalid file
async function validateFiles(files, allowedMimes) {
    const results = await Promise.all(files.map((f) => validateMagicNumber(f.path, allowedMimes)));
    return results.every(Boolean);
}

module.exports = { detectMime, validateMagicNumber, validateFiles, validateBufferMagicNumber, ALLOWED_IMAGE_MIMES, ALLOWED_DOCUMENT_MIMES };
