const express  = require('express');
const supabase = require('../lib/supabase');
const { auth } = require('../middleware/auth');

const router = express.Router();
router.use(auth(true));

// GET /api/v1/favorites — list my favorites
router.get('/', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { data, error } = await supabase
            .from('favorites')
            .select('equipment_id, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ success: true, favorites: data ?? [] });
    } catch (err) { next(err); }
});

// GET /api/v1/favorites/ids — just the IDs for quick lookup
router.get('/ids', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { data, error } = await supabase
            .from('favorites')
            .select('equipment_id')
            .eq('user_id', userId);
        if (error) throw error;
        return res.json({ success: true, ids: (data ?? []).map(r => r.equipment_id) });
    } catch (err) { next(err); }
});

// POST /api/v1/favorites/:equipmentId — add to favorites
router.post('/:equipmentId', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { equipmentId } = req.params;
        const { error } = await supabase
            .from('favorites')
            .insert({ user_id: userId, equipment_id: equipmentId });
        if (error && error.code === '23505') {
            return res.status(409).json({ success: false, message: 'Already in favorites' });
        }
        if (error) throw error;
        return res.status(201).json({ success: true, message: 'Added to favorites' });
    } catch (err) { next(err); }
});

// DELETE /api/v1/favorites/:equipmentId — remove from favorites
router.delete('/:equipmentId', async (req, res, next) => {
    try {
        const userId = req.user.id || req.user.sub;
        const { equipmentId } = req.params;
        const { error } = await supabase
            .from('favorites')
            .delete()
            .eq('user_id', userId)
            .eq('equipment_id', equipmentId);
        if (error) throw error;
        return res.json({ success: true, message: 'Removed from favorites' });
    } catch (err) { next(err); }
});

module.exports = router;
