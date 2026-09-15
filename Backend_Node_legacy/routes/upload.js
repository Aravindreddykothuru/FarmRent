const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { validateBufferMagicNumber, ALLOWED_IMAGE_MIMES, ALLOWED_DOCUMENT_MIMES } = require('../middleware/validateFileType');
const { auth } = require('../middleware/auth');
const { uploadToS3, getPresignedUploadUrl } = require('../lib/s3Storage');
const logger = require('../lib/logger');

const router = express.Router();

// Memory storage configuration
const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
    // Basic extension check. Real magic-number checks are performed post-receive.
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        return cb(new Error('File extension is not allowed'));
    }
    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 5,
    },
});

/**
 * POST /api/v1/upload/images
 * Core image uploading endpoint. Returns direct public URLs.
 */
router.post('/images', auth(true), (req, res) => {
    upload.array('images', 5)(req, res, async (err) => {
        if (err) {
            const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({ error: err.message });
        }

        const files = req.files || [];
        if (!files.length) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        try {
            // Verify all files are valid images using magic-number validation
            for (const file of files) {
                const isValid = await validateBufferMagicNumber(file.buffer, ALLOWED_IMAGE_MIMES);
                if (!isValid) {
                    return res.status(400).json({ error: `Invalid image content in file '${file.originalname}'` });
                }
            }

            // Upload concurrently to S3
            const uploadPromises = files.map(async (file) => {
                const hash = crypto.randomBytes(8).toString('hex');
                const uniqueKey = `machines/${Date.now()}-${hash}${path.extname(file.originalname) || '.jpg'}`;
                return uploadToS3(uniqueKey, file.buffer, file.mimetype);
            });

            const urls = await Promise.all(uploadPromises);

            return res.status(201).json({
                message: 'Images uploaded successfully',
                urls,
                data: { urls },
            });
        } catch (uploadError) {
            logger.error('[upload/images] Cloud storage upload failed:', { error: uploadError.message });
            return res.status(500).json({ error: 'Cloud storage upload failed' });
        }
    });
});

/**
 * POST /api/v1/upload/presign
 * Request presigned PUT URL for secure, direct client-to-cloud upload.
 */
router.post('/presign', auth(true), express.json(), async (req, res) => {
    const { filename, contentType, type } = req.body;
    if (!filename || !contentType) {
        return res.status(400).json({ error: 'filename and contentType are required' });
    }

    const folder = type === 'kyc' ? 'kyc' : type === 'rental' ? 'rentals' : 'misc';
    const hash = crypto.randomBytes(8).toString('hex');
    const key = `${folder}/${Date.now()}-${hash}${path.extname(filename)}`;

    try {
        const uploadUrl = await getPresignedUploadUrl(key, contentType);
        return res.json({
            uploadUrl,
            key,
            url: uploadUrl.split('?')[0], // Public base URL
        });
    } catch (err) {
        logger.error('[upload/presign] Failed to create presigned upload URL:', { error: err.message });
        return res.status(500).json({ error: 'Failed to create presigned upload URL' });
    }
});

/**
 * POST /api/v1/upload/kyc
 * Handles uploading KYC documents.
 */
router.post('/kyc', auth(true), (req, res) => {
    upload.single('document')(req, res, async (err) => {
        if (err) {
            const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({ error: err.message });
        }

        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No document uploaded' });
        }

        try {
            // Verify file magic number
            const isValid = await validateBufferMagicNumber(file.buffer, ALLOWED_DOCUMENT_MIMES);
            if (!isValid) {
                return res.status(400).json({ error: 'Invalid document file content. Only PDF and images are allowed.' });
            }

            const hash = crypto.randomBytes(8).toString('hex');
            const key = `kyc/${req.user.id}-${Date.now()}-${hash}${path.extname(file.originalname)}`;

            const url = await uploadToS3(key, file.buffer, file.mimetype);

            return res.status(201).json({
                message: 'KYC document uploaded successfully',
                url,
                key,
            });
        } catch (uploadError) {
            logger.error('[upload/kyc] KYC document upload failed:', { error: uploadError.message });
            return res.status(500).json({ error: 'Cloud storage upload failed' });
        }
    });
});

module.exports = router;
