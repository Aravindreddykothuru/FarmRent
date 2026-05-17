const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const supabase = require('../lib/supabase');
const { sendNotification } = require('../lib/notificationService');

const VALID_TYPES = ['equipment_damage', 'non_return', 'payment_dispute', 'service_issue', 'other'];

// POST /api/v1/disputes — file a dispute
router.post('/', asyncHandler(async (req, res) => {
    const { bookingId, type, description, evidenceUrls = [] } = req.body || {};

    if (!bookingId)   return res.status(400).json({ status: 'error', message: 'bookingId is required' });
    if (!type || !VALID_TYPES.includes(type)) return res.status(400).json({ status: 'error', message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    if (!description?.trim()) return res.status(400).json({ status: 'error', message: 'description is required' });
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    // Verify booking belongs to user
    const { data: booking } = await supabase
        .from('bookings')
        .select('id, renter_id, owner_id')
        .eq('id', bookingId)
        .single();
    if (!booking) return res.status(404).json({ status: 'error', message: 'Booking not found' });
    if (booking.renter_id !== req.user.id && booking.owner_id !== req.user.id) {
        return res.status(403).json({ status: 'error', message: 'Not your booking' });
    }

    const { data, error } = await supabase
        .from('disputes')
        .insert({
            booking_id:    bookingId,
            raised_by:     req.user.id,
            type,
            description:   description.trim(),
            evidence_urls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
            status:        'open',
        })
        .select()
        .single();

    if (error) throw error;

    // Notify admins
    const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
    if (admins?.length) {
        admins.forEach(a => sendNotification(a.id, {
            type: 'system',
            title: 'New Dispute Filed',
            message: `A ${type.replace(/_/g, ' ')} dispute has been filed.`,
            data: { disputeId: data.id, bookingId },
        }).catch(() => {}));
    }

    return res.status(201).json({ success: true, dispute: data });
}));

// GET /api/v1/disputes/my
router.get('/my', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ disputes: [] });

    const { data } = await supabase
        .from('disputes')
        .select('*, bookings(id, start_date, end_date, equipment(name))')
        .eq('raised_by', req.user.id)
        .order('created_at', { ascending: false });

    return res.json({ disputes: data || [] });
}));

// GET /api/v1/disputes/admin — admin only
router.get('/admin', auth(true), asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Admin only' });
    if (!supabase) return res.json({ disputes: [] });

    const { data } = await supabase
        .from('disputes')
        .select('*, bookings(id, renter_id, owner_id, equipment(name)), users!raised_by(name, email)')
        .order('created_at', { ascending: false });

    return res.json({ disputes: data || [] });
}));

// PATCH /api/v1/disputes/admin/:id — resolve dispute
router.patch('/admin/:id', auth(true), asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ status: 'error', message: 'Admin only' });
    const { status, admin_notes } = req.body || {};

    const validStatuses = ['open', 'under_review', 'resolved_farmer', 'resolved_owner', 'closed'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ status: 'error', message: `status must be one of: ${validStatuses.join(', ')}` });
    }
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const { data: dispute } = await supabase.from('disputes').select('raised_by, booking_id').eq('id', req.params.id).single();
    if (!dispute) return res.status(404).json({ status: 'error', message: 'Dispute not found' });

    const { data, error } = await supabase
        .from('disputes')
        .update({
            status,
            admin_notes: admin_notes || null,
            resolved_by: req.user.id,
            resolved_at: status.startsWith('resolved') || status === 'closed' ? new Date().toISOString() : null,
        })
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) throw error;

    // Notify the user who filed the dispute
    if (dispute.raised_by) {
        sendNotification(dispute.raised_by, {
            type: 'system',
            title: 'Dispute Update',
            message: `Your dispute status: ${status.replace(/_/g, ' ')}.${admin_notes ? ' Note: ' + admin_notes : ''}`,
            data: { disputeId: req.params.id, bookingId: dispute.booking_id },
        }).catch(() => {});
    }

    return res.json({ success: true, dispute: data });
}));

module.exports = router;
