/**
 * KYC documents — /api/v1/kyc (mounted behind auth(true))
 *
 * Files are identity documents: they are stored under uploads/kyc (never served statically) and
 * downloaded only through GET /documents/:id/file by their owner or an admin.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();

const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');
const { asyncHandler } = require('../middleware/asyncHandler');
const { requireRole } = require('../middleware/requireRole');
const { validate } = require('../middleware/validate');
const { validateMagicNumber, ALLOWED_DOCUMENT_MIMES } = require('../middleware/validateFileType');
const { sendNotification } = require('../lib/notificationService');
const { kycUploadSchema, kycRejectSchema } = require('../validations/schemas');
const { ROLE_IDS } = require('../lib/roles');

const KYC_DIR = path.join(__dirname, '../uploads/kyc');
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
fs.mkdirSync(KYC_DIR, { recursive: true });

const kycUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, KYC_DIR),
        filename: (req, file, cb) => {
            req.kycDocumentId = crypto.randomUUID();
            cb(null, `${req.kycDocumentId}${path.extname(file.originalname).toLowerCase()}`);
        },
    }),
    fileFilter: (_req, file, cb) => {
        const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
        if (!allowedMime || !ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) {
            return cb(new HttpError(400, 'UNSUPPORTED_FILE', 'Only JPG, PNG, WEBP images and PDFs are allowed'));
        }
        return cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

function notify(userId, payload) {
    sendNotification(userId, payload).catch((err) => logger.warn('[kyc] notification enqueue failed', { userId, error: err.message }));
}

async function notifyAdmins(payload) {
    const { data: admins, error } = await db().from('user_roles').select('user_id').eq('role_id', ROLE_IDS.admin);
    if (error) {
        logger.warn('[kyc] could not load admins to notify', { error: error.message });
        return;
    }
    (admins || []).forEach((a) => notify(a.user_id, payload));
}

function discardUpload(file) {
    if (!file) return;
    fs.promises
        .unlink(file.path)
        .catch((err) => logger.warn('[kyc] could not remove rejected upload', { file: file.filename, error: err.message }));
}

const receiveDocument = (req, res, next) => {
    kycUpload.single('document')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError) {
            return next(
                new HttpError(
                    err.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
                    err.code,
                    err.code === 'LIMIT_FILE_SIZE' ? 'File must be 5 MB or smaller' : err.message,
                ),
            );
        }
        return next(err);
    });
};

// POST /api/v1/kyc/upload — upload a KYC document
router.post(
    '/upload',
    receiveDocument,
    asyncHandler(async (req, res) => {
        if (!req.file) throw new HttpError(400, 'NO_FILE', 'No file uploaded');

        const parsed = kycUploadSchema.safeParse(req.body || {});
        if (!parsed.success) {
            discardUpload(req.file);
            throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join(', '));
        }
        if (!(await validateMagicNumber(req.file.path, ALLOWED_DOCUMENT_MIMES))) {
            discardUpload(req.file);
            throw new HttpError(400, 'UNSUPPORTED_FILE', 'Invalid file content. Only images and PDFs are allowed.');
        }

        const { doc_type } = parsed.data;
        const documentId = req.kycDocumentId;

        // Replace an earlier pending document of the same type.
        const { data: replaced, error: findError } = await db()
            .from('kyc_documents')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('doc_type', doc_type)
            .eq('status', 'pending');
        if (findError) throw findError;

        const { data, error } = await db()
            .from('kyc_documents')
            .insert({
                id: documentId,
                user_id: req.user.id,
                doc_type,
                file_url: `/api/v1/kyc/documents/${documentId}/file`,
                status: 'pending',
            })
            .select('id, doc_type, status, file_url, created_at')
            .single();
        if (error) {
            discardUpload(req.file);
            throw error;
        }

        if (replaced?.length) {
            const ids = replaced.map((r) => r.id);
            const { error: deleteError } = await db().from('kyc_documents').delete().in('id', ids);
            if (deleteError) logger.warn('[kyc] could not remove replaced documents', { ids, error: deleteError.message });
            ids.forEach((id) =>
                fs
                    .readdirSync(KYC_DIR)
                    .filter((f) => f.startsWith(id))
                    .forEach((f) =>
                        fs.promises
                            .unlink(path.join(KYC_DIR, f))
                            .catch((err) => logger.warn('[kyc] could not remove replaced file', { file: f, error: err.message })),
                    ),
            );
        }

        const { error: statusError } = await db().from('users').update({ kyc_status: 'pending' }).eq('id', req.user.id);
        if (statusError) throw statusError;

        await notifyAdmins({
            type: 'system',
            title: 'KYC Document Submitted',
            message: `A user submitted ${doc_type.replace(/_/g, ' ')} for verification.`,
            data: { kycId: data.id, userId: req.user.id },
        });

        return res.status(201).json({ success: true, document: data });
    }),
);

// GET /api/v1/kyc/status — current user's KYC documents
router.get(
    '/status',
    asyncHandler(async (req, res) => {
        const [{ data: documents, error }, { data: user, error: userError }] = await Promise.all([
            db()
                .from('kyc_documents')
                .select('id, doc_type, status, rejection_reason, file_url, created_at')
                .eq('user_id', req.user.id)
                .order('created_at', { ascending: false }),
            db().from('users').select('kyc_status').eq('id', req.user.id).single(),
        ]);
        if (error) throw error;
        if (userError) throw userError;

        return res.json({ documents: documents || [], kyc_status: user.kyc_status });
    }),
);

// GET /api/v1/kyc/documents/:id/file — the document itself, for its owner or an admin
router.get(
    '/documents/:id/file',
    asyncHandler(async (req, res) => {
        if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
        const { data: doc, error } = await db().from('kyc_documents').select('id, user_id').eq('id', req.params.id).maybeSingle();
        if (error) throw error;
        if (!doc || (doc.user_id !== req.user.id && !req.user.roles.includes('admin'))) {
            throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
        }
        const file = fs.readdirSync(KYC_DIR).find((f) => f.startsWith(doc.id));
        if (!file) throw new HttpError(404, 'DOCUMENT_FILE_MISSING', 'Document file not found');

        res.set('Cache-Control', 'private, no-store');
        return res.sendFile(path.join(KYC_DIR, file));
    }),
);

// GET /api/v1/kyc/admin — all documents (admin only)
router.get(
    '/admin',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('kyc_documents')
            .select('id, doc_type, file_url, status, rejection_reason, created_at, users!user_id(id, full_name, email)')
            .order('created_at', { ascending: true })
            .limit(500);
        if (error) throw error;

        const documents = (data || []).map((item) => ({
            ...item,
            users: item.users ? { ...item.users, name: item.users.full_name } : null,
        }));
        return res.json({ documents });
    }),
);

async function reviewDocument(req, status, extra = {}) {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    const { data: doc, error } = await db()
        .from('kyc_documents')
        .update({ status, reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), ...extra })
        .eq('id', req.params.id)
        .select('id, user_id')
        .maybeSingle();
    if (error) throw error;
    if (!doc) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    return doc;
}

// PATCH /api/v1/kyc/admin/:id/approve
router.patch(
    '/admin/:id/approve',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        const doc = await reviewDocument(req, 'approved', { rejection_reason: null });

        // The account is verified once every submitted document is approved.
        const { count, error } = await db()
            .from('kyc_documents')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', doc.user_id)
            .neq('status', 'approved');
        if (error) throw error;
        if (count === 0) {
            const { error: verifyError } = await db().from('users').update({ kyc_status: 'verified' }).eq('id', doc.user_id);
            if (verifyError) throw verifyError;
        }

        notify(doc.user_id, {
            type: 'system',
            title: 'Document Approved',
            message: 'Your KYC document has been approved.',
            data: { kycId: doc.id },
        });
        return res.json({ success: true });
    }),
);

// PATCH /api/v1/kyc/admin/:id/reject
router.patch(
    '/admin/:id/reject',
    requireRole('admin'),
    validate(kycRejectSchema),
    asyncHandler(async (req, res) => {
        const { reason } = req.body;
        const doc = await reviewDocument(req, 'rejected', { rejection_reason: reason });

        const { error } = await db().from('users').update({ kyc_status: 'rejected' }).eq('id', doc.user_id);
        if (error) throw error;

        notify(doc.user_id, {
            type: 'system',
            title: 'Document Rejected',
            message: `Your KYC document was rejected: ${reason}`,
            data: { kycId: doc.id },
        });
        return res.json({ success: true });
    }),
);

module.exports = router;
