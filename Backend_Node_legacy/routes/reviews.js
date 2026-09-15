const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const supabase = require('../lib/supabase');
const { validate } = require('../middleware/validate');
const { reviewCreateSchema } = require('../validations/schemas');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/v1/reviews/machine/:id — public
router.get(
    '/machine/:id',
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!UUID_RE.test(id)) return res.status(404).json({ status: 'error', code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
        const { data, error } = await supabase
            .from('reviews')
            .select('id, rating, comment, created_at, users(full_name)')
            .eq('equipment_id', id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const reviews = (data || []).map((r) => ({
            id: r.id,
            user: r.users?.full_name || 'Anonymous',
            rating: r.rating,
            comment: r.comment,
            date: r.created_at?.split('T')[0] || '',
        }));

        return res.json({ reviews });
    }),
);

// POST /api/v1/reviews — auth required
router.post(
    '/',
    auth(true),
    validate(reviewCreateSchema),
    asyncHandler(async (req, res) => {
        const { bookingId, rating, reviewText, comment } = req.body || {};
        const text = reviewText || comment || '';

        // Verify booking belongs to user and is completed
        const { data: booking, error: bErr } = await supabase
            .from('equipment_rentals')
            .select('id, renter_id, equipment_id, status')
            .eq('id', bookingId)
            .single();

        if (bErr || !booking) return res.status(404).json({ status: 'error', message: 'Booking not found' });
        if (booking.renter_id !== req.user.id) return res.status(403).json({ status: 'error', message: 'Not your booking' });
        if (booking.status !== 'completed') return res.status(400).json({ status: 'error', message: 'Can only review completed bookings' });

        // Check for duplicate
        const { data: existing } = await supabase.from('reviews').select('id').eq('booking_id', bookingId).maybeSingle();

        if (existing) return res.status(409).json({ status: 'error', message: 'You have already reviewed this booking' });

        // Insert review
        const { data: review, error: rErr } = await supabase
            .from('reviews')
            .insert({
                booking_id: bookingId,
                equipment_id: booking.equipment_id,
                reviewer_id: req.user.id,
                rating: Number(rating),
                comment: text || null,
            })
            .select()
            .single();

        if (rErr) throw rErr;

        // Recompute avg_rating on equipment
        await supabase.rpc('compute_equipment_avg_rating', { p_equipment_id: booking.equipment_id });

        return res.status(201).json({ success: true, review });
    }),
);

// DELETE /api/v1/reviews/:id — reviewer only
router.delete(
    '/:id',
    auth(true),
    asyncHandler(async (req, res) => {
        if (!UUID_RE.test(req.params.id))
            return res.status(404).json({ status: 'error', code: 'REVIEW_NOT_FOUND', message: 'Review not found' });
        const { data: review, error } = await supabase
            .from('reviews')
            .select('id, reviewer_id, equipment_id')
            .eq('id', req.params.id)
            .maybeSingle();

        if (error) throw error;
        if (!review) return res.status(404).json({ status: 'error', code: 'REVIEW_NOT_FOUND', message: 'Review not found' });
        if (review.reviewer_id !== req.user.id && !req.user.roles?.includes('admin')) {
            return res.status(403).json({ status: 'error', message: 'Forbidden' });
        }

        const { error: deleteError } = await supabase.from('reviews').delete().eq('id', req.params.id);
        if (deleteError) throw deleteError;
        const { error: ratingError } = await supabase.rpc('compute_equipment_avg_rating', { p_equipment_id: review.equipment_id });
        if (ratingError) throw ratingError;

        return res.json({ success: true });
    }),
);

module.exports = router;
