const express = require('express');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validate } = require('../middleware/validate');
const { offerCreateSchema, offerRespondSchema } = require('../validations/schemas');
const { sendNotification } = require('../lib/notificationService');
const { todayIso } = require('../services/booking-service/pricing');

const router = express.Router();
router.use(auth(true));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER_SELECT = '*, equipment(id, name, images, daily_rate)';

function notify(userId, payload) {
    sendNotification(userId, payload).catch((err) => logger.warn('[offers] notification enqueue failed', { userId, error: err.message }));
}

// POST /api/v1/offers — renter makes a price offer
router.post(
    '/',
    validate(offerCreateSchema),
    asyncHandler(async (req, res) => {
        const { equipment_id, offered_price_per_day, start_date, end_date, message } = req.body;
        if (start_date < todayIso()) throw new HttpError(400, 'START_DATE_IN_PAST', 'Start date cannot be in the past');

        const { data: equipment, error: equipmentError } = await supabase
            .from('equipment')
            .select('owner_id, name, is_deleted, status')
            .eq('id', equipment_id)
            .maybeSingle();
        if (equipmentError) throw equipmentError;
        if (!equipment || equipment.is_deleted) throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');
        if (equipment.owner_id === req.user.id) throw new HttpError(400, 'OWN_EQUIPMENT', 'You cannot make an offer on your own listing');

        const { data: offer, error } = await supabase
            .from('offers')
            .insert({
                equipment_id,
                renter_id: req.user.id,
                owner_id: equipment.owner_id,
                offered_price_per_day,
                start_date,
                end_date,
                message: message ?? null,
            })
            .select(OFFER_SELECT)
            .single();
        if (error) throw error;

        notify(equipment.owner_id, {
            type: 'new_offer',
            title: 'New Price Offer',
            message: `Someone offered ₹${offered_price_per_day}/day for ${equipment.name}`,
            data: { offerId: offer.id, equipmentId: equipment_id },
        });

        return res.status(201).json({ success: true, offer });
    }),
);

// GET /api/v1/offers/my — renter's sent offers
router.get(
    '/my',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('offers')
            .select(OFFER_SELECT)
            .eq('renter_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) throw error;
        return res.json({ success: true, offers: data ?? [] });
    }),
);

// GET /api/v1/offers/received — owner's received offers
router.get(
    '/received',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('offers')
            .select(OFFER_SELECT)
            .eq('owner_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(200);
        if (error) throw error;
        return res.json({ success: true, offers: data ?? [] });
    }),
);

// PATCH /api/v1/offers/:id/respond — owner accepts / rejects / counters
router.patch(
    '/:id/respond',
    validate(offerRespondSchema),
    asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!UUID_RE.test(id)) throw new HttpError(404, 'OFFER_NOT_FOUND', 'Offer not found');
        const { action, counter_price, counter_message } = req.body;

        const update = { status: action };
        if (action === 'countered') {
            update.counter_price = counter_price;
            update.counter_message = counter_message ?? null;
        }

        // Conditional on still being pending, so two responses cannot both apply.
        const { data: offer, error } = await supabase
            .from('offers')
            .update(update)
            .eq('id', id)
            .eq('owner_id', req.user.id)
            .eq('status', 'pending')
            .select(OFFER_SELECT)
            .maybeSingle();
        if (error) throw error;
        if (!offer) {
            const { data: existing, error: findError } = await supabase
                .from('offers')
                .select('status')
                .eq('id', id)
                .eq('owner_id', req.user.id)
                .maybeSingle();
            if (findError) throw findError;
            if (!existing) throw new HttpError(404, 'OFFER_NOT_FOUND', 'Offer not found');
            throw new HttpError(409, 'OFFER_ALREADY_ANSWERED', 'Offer already responded to');
        }

        const titles = { accepted: 'Offer Accepted!', rejected: 'Offer Declined', countered: 'Counter Offer Received' };
        notify(offer.renter_id, {
            type: `offer_${action}`,
            title: titles[action],
            message: action === 'countered' ? `Owner countered with ₹${counter_price}/day` : `Your offer was ${action}`,
            data: { offerId: id, equipmentId: offer.equipment_id },
        });

        return res.json({ success: true, offer });
    }),
);

module.exports = router;
