const express = require('express');
const router  = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const supabase = require('../../lib/supabase');
const { auth } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { equipmentCreateSchema, equipmentUpdateSchema } = require('../../validations/schemas');

function requireDb(res) {
    if (!supabase) {
        res.status(503).json({ success: false, error: 'Database not configured' });
        return false;
    }
    return true;
}

async function ensureOwner(req, res, equipmentId) {
    const uid = req.user?.id || req.user?.sub;
    if (!uid) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!requireDb(res)) return null;
    const { data, error } = await supabase.from('equipment').select('id, owner_id').eq('id', equipmentId).single();
    if (error || !data) return res.status(404).json({ success: false, error: 'Equipment not found' });
    if (data.owner_id && String(data.owner_id) !== String(uid)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    return data;
}

// GET /api/v1/equipment — list all (with optional ?type=&location=&status= filters)
// lat/lng intentionally excluded from list — revealed only on detail to confirmed renters
router.get('/', asyncHandler(async (req, res) => {
    const { type, location, status, limit = 50, offset = 0 } = req.query;

    if (!requireDb(res)) return;

    let query = supabase
        .from('equipment')
        .select('id, owner_id, name, type, description, price_per_day, location, images, status, horsepower, year, brand, is_approved, created_at, updated_at')
        .eq('is_approved', true);
    if (type)     query = query.ilike('type', `%${type}%`);
    if (location) query = query.ilike('location', `%${location}%`);
    if (status)   query = query.eq('status', status);
    query = query.order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, data: data || [], count: (data || []).length });
}));

// GET /api/v1/equipment/:id
// Exact lat/lng revealed only to the equipment owner or users with a confirmed booking
router.get('/:id', auth(false), asyncHandler(async (req, res) => {
    if (!requireDb(res)) return;
    const { data, error } = await supabase
        .from('equipment')
        .select('id, owner_id, name, type, description, price_per_day, location, latitude, longitude, images, status, horsepower, year, brand, is_approved, created_at, updated_at')
        .eq('id', req.params.id)
        .single();
    if (error || !data) return res.status(404).json({ success: false, error: 'Equipment not found' });

    const userId = req.user?.id || req.user?.sub;
    let locationRevealed = false;
    if (userId) {
        if (String(data.owner_id) === String(userId)) {
            locationRevealed = true;
        } else {
            const { data: booking } = await supabase
                .from('bookings')
                .select('id')
                .eq('equipment_id', req.params.id)
                .eq('renter_id', userId)
                .in('status', ['confirmed', 'active', 'completed'])
                .maybeSingle();
            locationRevealed = !!booking;
        }
    }

    const response = locationRevealed ? data : { ...data, latitude: null, longitude: null };
    return res.json({ success: true, data: response, location_revealed: locationRevealed });
}));

// POST /api/v1/equipment — add new listing
router.post('/', auth(true), validate(equipmentCreateSchema), asyncHandler(async (req, res) => {
    const { name, type, description, price_per_day, location, images, horsepower, year, brand } = req.body || {};
    if (!name || !type || !price_per_day) return res.status(400).json({ error: 'name, type and price_per_day are required' });

    const ownerId = req.user?.id || req.user?.sub || null;

    if (!requireDb(res)) return;
    const { data, error } = await supabase
        .from('equipment')
        .insert({ name, type, description, price_per_day, location, images: images || [], horsepower, year, brand, owner_id: ownerId })
        .select()
        .single();
    if (error) throw error;
    return res.status(201).json({ success: true, data });
}));

// PATCH /api/v1/equipment/:id
router.patch('/:id', auth(true), validate(equipmentUpdateSchema), asyncHandler(async (req, res) => {
    const existing = await ensureOwner(req, res, req.params.id);
    if (!existing) return;
    const { data, error } = await supabase.from('equipment').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, error: 'Equipment not found' });
    return res.json({ success: true, data });
}));

// DELETE /api/v1/equipment/:id
router.delete('/:id', auth(true), asyncHandler(async (req, res) => {
    const existing = await ensureOwner(req, res, req.params.id);
    if (!existing) return;
    const { error } = await supabase.from('equipment').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true, message: 'Equipment deleted' });
}));

module.exports = router;
