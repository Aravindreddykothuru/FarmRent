const express = require('express');
const supabase = require('../lib/supabase');
const { HttpError } = require('../lib/httpError');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();
router.use(auth(true));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function equipmentIdParam(req) {
    const { equipmentId } = req.params;
    if (!UUID_RE.test(equipmentId)) throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');
    return equipmentId;
}

// GET /api/v1/favorites — list my favorites with listing summaries
router.get(
    '/',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('favorites')
            .select('equipment_id, created_at, equipment(id, name, category, images, daily_rate, district, state, status, is_deleted)')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, data: data ?? [] });
    }),
);

// GET /api/v1/favorites/ids — just the IDs for quick lookup
router.get(
    '/ids',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase.from('favorites').select('equipment_id').eq('user_id', req.user.id);
        if (error) throw error;
        return res.json({ success: true, ids: (data ?? []).map((r) => r.equipment_id) });
    }),
);

// POST /api/v1/favorites/:equipmentId — add to favorites
router.post(
    '/:equipmentId',
    asyncHandler(async (req, res) => {
        const equipmentId = equipmentIdParam(req);
        const { error } = await supabase.from('favorites').insert({ user_id: req.user.id, equipment_id: equipmentId });
        if (error?.code === '23505') throw new HttpError(409, 'ALREADY_FAVORITE', 'Already in favorites');
        if (error?.code === '23503') throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');
        if (error) throw error;
        return res.status(201).json({ success: true, message: 'Added to favorites' });
    }),
);

// DELETE /api/v1/favorites/:equipmentId — remove from favorites
router.delete(
    '/:equipmentId',
    asyncHandler(async (req, res) => {
        const equipmentId = equipmentIdParam(req);
        const { error } = await supabase.from('favorites').delete().eq('user_id', req.user.id).eq('equipment_id', equipmentId);
        if (error) throw error;
        return res.json({ success: true, message: 'Removed from favorites' });
    }),
);

module.exports = router;
