const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const supabase = require('../lib/supabase');
const { sendNotification } = require('../lib/notificationService');
const { validateMagicNumber, ALLOWED_DOCUMENT_MIMES } = require('../middleware/validateFileType');

const kycDir = path.join(__dirname, '../uploads/kyc');
if (!fs.existsSync(kycDir)) fs.mkdirSync(kycDir, { recursive: true });

const kycUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, kycDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `kyc_${Date.now()}_${require('crypto').randomBytes(8).toString('hex')}${ext}`);
        },
    }),
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowed.includes(file.mimetype)) return cb(new Error('Only images and PDFs allowed'));
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

const DOC_TYPES = ['aadhar', 'driving_license', 'farm_proof', 'gst'];

// POST /api/v1/kyc/upload — upload a KYC document
router.post('/upload', (req, res, _next) => {
    kycUpload.single('document')(req, res, async (err) => {
        if (err) return res.status(400).json({ status: 'error', message: err.message });
        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file uploaded' });

        const isValid = await validateMagicNumber(req.file.path, ALLOWED_DOCUMENT_MIMES);
        if (!isValid) {
            return res.status(400).json({ status: 'error', message: 'Invalid file content. Only images and PDFs are allowed.' });
        }

        const { doc_type } = req.body || {};
        if (!DOC_TYPES.includes(doc_type)) {
            return res.status(400).json({ status: 'error', message: `doc_type must be one of: ${DOC_TYPES.join(', ')}` });
        }
        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const fileUrl = `${baseUrl}/uploads/kyc/${req.file.filename}`;

        // Upsert: replace existing pending document of same type
        await supabase.from('kyc_documents')
            .delete()
            .eq('user_id', req.user.id)
            .eq('doc_type', doc_type)
            .eq('status', 'pending');

        const { data, error } = await supabase
            .from('kyc_documents')
            .insert({ user_id: req.user.id, doc_type, file_url: fileUrl, status: 'pending' })
            .select()
            .single();

        if (error) throw error;

        // Update user kyc_status → pending
        await supabase.from('users').update({ kyc_status: 'pending' }).eq('id', req.user.id);

        // Notify admins
        const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
        if (admins?.length) {
            admins.forEach(a => sendNotification(a.id, {
                type: 'system',
                title: 'KYC Document Submitted',
                message: `A user submitted ${doc_type.replace(/_/g, ' ')} for verification.`,
                data: { kycId: data.id, userId: req.user.id },
            }).catch(() => {}));
        }

        return res.status(201).json({ success: true, document: data });
    });
});

// GET /api/v1/kyc/status — current user's KYC documents
router.get('/status', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ documents: [] });

    const { data } = await supabase
        .from('kyc_documents')
        .select('id, doc_type, status, rejection_reason, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });

    const { data: user } = await supabase.from('users').select('kyc_status').eq('id', req.user.id).single();

    return res.json({ documents: data || [], kyc_status: user?.kyc_status || 'unverified' });
}));

// GET /api/v1/kyc/admin — all pending documents (admin only)
router.get('/admin', auth(true), asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Admin only' });
    if (!supabase) return res.json({ documents: [] });

    const { data } = await supabase
        .from('kyc_documents')
        .select('id, doc_type, file_url, status, created_at, users(id, name, email)')
        .order('created_at', { ascending: true });

    return res.json({ documents: data || [] });
}));

// PATCH /api/v1/kyc/admin/:id/approve
router.patch('/admin/:id/approve', auth(true), asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Admin only' });
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const { data: doc } = await supabase.from('kyc_documents').select('user_id').eq('id', req.params.id).single();
    if (!doc) return res.status(404).json({ status: 'error', message: 'Document not found' });

    await supabase.from('kyc_documents').update({
        status: 'approved', reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    // Check if all docs approved — then mark user as verified
    const { data: pending } = await supabase.from('kyc_documents')
        .select('id').eq('user_id', doc.user_id).neq('status', 'approved');
    if (!pending?.length) {
        await supabase.from('users').update({ kyc_status: 'verified' }).eq('id', doc.user_id);
    }

    sendNotification(doc.user_id, {
        type: 'system',
        title: 'Document Approved',
        message: 'Your KYC document has been approved.',
        data: { kycId: req.params.id },
    }).catch(() => {});

    return res.json({ success: true });
}));

// PATCH /api/v1/kyc/admin/:id/reject
router.patch('/admin/:id/reject', auth(true), asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Admin only' });
    const { reason } = req.body || {};
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const { data: doc } = await supabase.from('kyc_documents').select('user_id').eq('id', req.params.id).single();
    if (!doc) return res.status(404).json({ status: 'error', message: 'Document not found' });

    await supabase.from('kyc_documents').update({
        status: 'rejected', rejection_reason: reason || 'Does not meet requirements',
        reviewed_by: req.user.id, reviewed_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    await supabase.from('users').update({ kyc_status: 'rejected' }).eq('id', doc.user_id);

    sendNotification(doc.user_id, {
        type: 'system',
        title: 'Document Rejected',
        message: `Your KYC document was rejected: ${reason || 'Does not meet requirements'}`,
        data: { kycId: req.params.id },
    }).catch(() => {});

    return res.json({ success: true });
}));

module.exports = router;
