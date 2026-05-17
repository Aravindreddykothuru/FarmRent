const express  = require('express');
const supabase = require('../lib/supabase');
const { auth } = require('../middleware/auth');
const { sendNotification } = require('../lib/notificationService');

const router = express.Router();
router.use(auth(true));

// POST /api/v1/offers — renter makes a price offer
router.post('/', async (req, res, next) => {
    try {
        const renterId = req.user.id || req.user.sub;
        const { equipment_id, offered_price_per_day, start_date, end_date, message } = req.body;

        if (!equipment_id || !offered_price_per_day || !start_date || !end_date) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Get equipment owner
        const { data: equip } = await supabase
            .from('equipment')
            .select('owner_id, name')
            .eq('id', equipment_id)
            .maybeSingle();

        if (!equip) return res.status(404).json({ success: false, message: 'Equipment not found' });

        const { data: offer, error } = await supabase
            .from('offers')
            .insert({
                equipment_id,
                renter_id:             renterId,
                owner_id:              equip.owner_id,
                offered_price_per_day: Number(offered_price_per_day),
                start_date,
                end_date,
                message,
            })
            .select()
            .single();

        if (error) throw error;

        // Notify owner
        sendNotification(equip.owner_id, {
            type: 'new_offer',
            title: 'New Price Offer',
            message: `Someone offered ₹${offered_price_per_day}/day for ${equip.name}`,
            data: { offerId: offer.id, equipmentId: equipment_id },
        }).catch(() => {});

        return res.status(201).json({ success: true, offer });
    } catch (err) { next(err); }
});

// GET /api/v1/offers/my — renter's sent offers
router.get('/my', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { data, error } = await supabase
            .from('offers')
            .select('*')
            .eq('renter_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, offers: data ?? [] });
    } catch (err) { next(err); }
});

// GET /api/v1/offers/received — owner's received offers
router.get('/received', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { data, error } = await supabase
            .from('offers')
            .select('*')
            .eq('owner_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, offers: data ?? [] });
    } catch (err) { next(err); }
});

// PATCH /api/v1/offers/:id/respond — owner accepts / rejects / counters
router.patch('/:id/respond', async (req, res, next) => {
    try {
        const ownerId = req.user.id || req.user.sub;
        const { id } = req.params;
        const { action, counter_price, counter_message } = req.body; // action: accepted|rejected|countered

        if (!['accepted', 'rejected', 'countered'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action' });
        }

        const { data: offer } = await supabase
            .from('offers')
            .select('id, renter_id, equipment_id, status')
            .eq('id', id)
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (!offer) return res.status(404).json({ success: false, message: 'Offer not found' });
        if (offer.status !== 'pending') {
            return res.status(409).json({ success: false, message: 'Offer already responded to' });
        }

        const update = { status: action, updated_at: new Date().toISOString() };
        if (action === 'countered') {
            if (!counter_price) return res.status(400).json({ success: false, message: 'counter_price required' });
            update.counter_price   = Number(counter_price);
            update.counter_message = counter_message;
        }

        const { data: updated, error } = await supabase
            .from('offers')
            .update(update)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        const titles = {
            accepted: 'Offer Accepted!',
            rejected: 'Offer Declined',
            countered: 'Counter Offer Received',
        };
        sendNotification(offer.renter_id, {
            type: `offer_${action}`,
            title: titles[action],
            message: action === 'countered'
                ? `Owner countered with ₹${counter_price}/day`
                : `Your offer was ${action}`,
            data: { offerId: id, equipmentId: offer.equipment_id },
        }).catch(() => {});

        return res.json({ success: true, offer: updated });
    } catch (err) { next(err); }
});

module.exports = router;
