const fileType = require('file-type');
const fs = require('fs');

const ALLOWED_IMAGE_MIMES    = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_DOCUMENT_MIMES = new Set([...ALLOWED_IMAGE_MIMES, 'application/pdf']);

async function validateMagicNumber(filePath, allowedMimes) {
    try {
        const fd  = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4100);
        fs.readSync(fd, buf, 0, 4100, 0);
        fs.closeSync(fd);
        const result = await fileType.fromBuffer(buf);
        if (!result || !allowedMimes.has(result.mime)) {
            fs.unlinkSync(filePath);
            return false;
        }
        return true;
    } catch {
        try { fs.unlinkSync(filePath); } catch { /* best-effort cleanup */ }
        return false;
    }
}

// Validates an array of multer file objects; deletes and returns false for any invalid file
async function validateFiles(files, allowedMimes) {
    const results = await Promise.all(files.map(f => validateMagicNumber(f.path, allowedMimes)));
    return results.every(Boolean);
}

module.exports = { validateMagicNumber, validateFiles, ALLOWED_IMAGE_MIMES, ALLOWED_DOCUMENT_MIMES };
