const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { validateFiles, ALLOWED_IMAGE_MIMES } = require('../middleware/validateFileType');

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + require('crypto').randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `${unique}${ext}`);
    },
});

const fileFilter = (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB per file
        files: 10,
    },
});

// POST /api/v1/upload/images
router.post('/images', (req, res, _next) => {
    upload.array('images', 10)(req, res, async (err) => {
        if (err) {
            const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({
                error: err.message,
                code: err.code,
                message: err.message,
            });
        }

        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({
                error: 'No images uploaded',
                message: 'No images uploaded',
            });
        }

        const allValid = await validateFiles(files, ALLOWED_IMAGE_MIMES);
        if (!allValid) {
            files.forEach(f => { try { fs.unlinkSync(f.path); } catch { /* ignore if already deleted */ } });
            return res.status(400).json({ error: 'Invalid file content. Only real image files are allowed.' });
        }

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const urls = files.map((f) => {
            const filename = path.basename(f.path);
            return `${baseUrl}/uploads/${filename}`;
        });

        // Match frontend expectations: data.urls and urls
        return res.status(201).json({
            message: 'Images uploaded successfully',
            urls,
            data: { urls },
        });
    });
});

module.exports = router;

