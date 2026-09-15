const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const supabase = require('../lib/supabase');
const { sendNotification } = require('../lib/notificationService');
const { validate } = require('../middleware/validate');
const { disputeCreateSchema, disputeResolveSchema } = require('../validations/schemas');

// POST /api/v1/disputes — file a dispute
router.post(
    '/',
    auth(true),
    validate(disputeCreateSchema),
    asyncHandler(async (req, res) => {
        const { bookingId, booking_id, type, description, evidenceUrls = [] } = req.body || {};
        const bId = bookingId || booking_id;

        if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

        // Verify booking belongs to user
        const { data: booking } = await supabase.from('equipment_rentals').select('id, renter_id, owner_id').eq('id', bId).single();
        if (!booking) return res.status(404).json({ status: 'error', message: 'Booking not found' });
        if (booking.renter_id !== req.user.id && booking.owner_id !== req.user.id) {
            return res.status(403).json({ status: 'error', message: 'Not your booking' });
        }

        const { data, error } = await supabase
            .from('disputes')
            .insert({
                booking_id: bId,
                raised_by: req.user.id,
                type,
                description: description.trim(),
                evidence_urls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
                status: 'open',
            })
            .select()
            .single();

        if (error) throw error;

        // Notify admins (role_id 4)
        const { data: admins } = await supabase.from('user_roles').select('user_id').eq('role_id', 4);
        if (admins?.length) {
            admins.forEach((a) =>
                sendNotification(a.user_id, {
                    type: 'system',
                    title: 'New Dispute Filed',
                    message: `A ${type.replace(/_/g, ' ')} dispute has been filed.`,
                    data: { disputeId: data.id, bookingId: bId },
                }).catch(() => {}),
            );
        }

        return res.status(201).json({ success: true, dispute: data });
    }),
);

// GET /api/v1/disputes/my
router.get(
    '/my',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.json({ disputes: [] });

        const { data } = await supabase
            .from('disputes')
            .select('*, bookings:equipment_rentals(id, start_date, end_date, equipment(name))')
            .eq('raised_by', req.user.id)
            .order('created_at', { ascending: false });

        return res.json({ disputes: data || [] });
    }),
);

// GET /api/v1/disputes/admin — admin only
router.get(
    '/admin',
    auth(true),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        if (!supabase) return res.json({ disputes: [] });

        const { data } = await supabase
            .from('disputes')
            .select('*, bookings:equipment_rentals(id, renter_id, owner_id, equipment(name)), users!raised_by(full_name, email)')
            .order('created_at', { ascending: false });

        const mappedData = (data || []).map((d) => {
            const mapped = { ...d };
            if (mapped.users) {
                mapped.users = {
                    ...mapped.users,
                    name: mapped.users.full_name,
                };
            }
            return mapped;
        });

        return res.json({ disputes: mappedData });
    }),
);

// PATCH /api/v1/disputes/admin/:id — resolve dispute
router.patch(
    '/admin/:id',
    auth(true),
    requireRole('admin'),
    validate(disputeResolveSchema),
    asyncHandler(async (req, res) => {
        const { status, admin_notes } = req.body || {};
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
    }),
);

module.exports = router;
