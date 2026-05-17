'use strict';

/**
 * Image upload route — /api/v1/upload
 * Uses multer for local disk storage + optional Cloudinary cloud upload.
 *
 * Env vars for Cloudinary (optional):
 *   CLOUDINARY_CLOUD_NAME=...
 *   CLOUDINARY_API_KEY=...
 *   CLOUDINARY_API_SECRET=...
 *
 * If not set, images are served from /uploads/ on the Node.js server.
 */

const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');
const { sendSuccess, createError } = require('../utils/helpers');

// ── Multer disk storage (local fallback) ──
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, name);
    },
});

const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files (jpg, png, webp, avif) are allowed'), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
});

// ── Optional Cloudinary client ──
let cloudinary;
try {
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
        cloudinary = require('cloudinary').v2;
        cloudinary.config({
            cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
            api_key: process.env.CLOUDINARY_API_KEY,
            api_secret: process.env.CLOUDINARY_API_SECRET,
        });
    }
} catch { /* cloudinary optional */ }

async function uploadToCloud(localPath, publicId) {
    if (!cloudinary) return null;
    const result = await cloudinary.uploader.upload(localPath, {
        folder: 'farmrent/equipment',
        public_id: publicId,
        overwrite: true,
        resource_type: 'image',
        transformation: [{ width: 1280, height: 960, crop: 'limit', quality: 'auto:good' }],
    });
    // Remove local file after uploading to cloud
    try { fs.unlinkSync(localPath); } catch { /**/ }
    return result.secure_url;
}

// POST /api/v1/upload/images — upload up to 5 equipment images
router.post('/images', protect, upload.array('images', 5), async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) return next(createError(400, 'No images uploaded'));

        const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const urls = [];

        for (const file of req.files) {
            const cloudUrl = await uploadToCloud(file.path, path.parse(file.filename).name);
            if (cloudUrl) {
                urls.push(cloudUrl);
            } else {
                // Serve locally
                urls.push(`${BASE_URL}/uploads/${file.filename}`);
            }
        }

        sendSuccess(res, { urls, count: urls.length });
    } catch (err) { next(err); }
});

// DELETE /api/v1/upload/image — delete an image (Cloudinary only)
router.delete('/image', protect, async (req, res, next) => {
    try {
        const { publicId } = req.body;
        if (!publicId) return next(createError(400, 'publicId required'));
        if (!cloudinary) return next(createError(400, 'Cloud storage not configured'));
        await cloudinary.uploader.destroy(publicId);
        sendSuccess(res, { message: 'Image deleted' });
    } catch (err) { next(err); }
});

module.exports = router;
