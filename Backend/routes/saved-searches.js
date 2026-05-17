const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { asyncHandler } = require('../middleware/asyncHandler');

// GET /api/v1/saved-searches — list user's saved searches
router.get('/', asyncHandler(async (req, res) => {
    const { data, error } = await supabase
        .from('saved_searches')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data: data ?? [] });
}));

// POST /api/v1/saved-searches — create a saved search
router.post('/', asyncHandler(async (req, res) => {
    const { name, filters, alert_on = false } = req.body;
    if (!name || !filters) return res.status(400).json({ status: 'error', message: 'name and filters are required' });
    const { data, error } = await supabase
        .from('saved_searches')
        .insert({ user_id: req.user.id, name, filters, alert_on })
        .select()
        .single();
    if (error) throw error;
    res.status(201).json({ success: true, data });
}));

// PATCH /api/v1/saved-searches/:id — update alert_on toggle
router.patch('/:id', asyncHandler(async (req, res) => {
    const { alert_on } = req.body;
    const { data, error } = await supabase
        .from('saved_searches')
        .update({ alert_on })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ status: 'error', message: 'Saved search not found' });
    res.json({ success: true, data });
}));

// DELETE /api/v1/saved-searches/:id
router.delete('/:id', asyncHandler(async (req, res) => {
    const { error } = await supabase
        .from('saved_searches')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).end();
}));

module.exports = router;
