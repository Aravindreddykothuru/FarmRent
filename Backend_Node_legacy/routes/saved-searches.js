const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { HttpError } = require('../lib/httpError');
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { savedSearchCreateSchema, savedSearchUpdateSchema } = require('../validations/schemas');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Require authentication for all saved search endpoints
router.use(auth(true));

function savedSearchId(req) {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    return req.params.id;
}

// GET /api/v1/saved-searches — list user's saved searches
router.get(
    '/',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('saved_searches')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data ?? [] });
    }),
);

// POST /api/v1/saved-searches — create a saved search
router.post(
    '/',
    validate(savedSearchCreateSchema),
    asyncHandler(async (req, res) => {
        const { name, filters, alert_on = false } = req.body;
        const { data, error } = await supabase
            .from('saved_searches')
            .insert({ user_id: req.user.id, name, filters, alert_on })
            .select()
            .single();
        if (error) throw error;
        res.status(201).json({ success: true, data });
    }),
);

// PATCH /api/v1/saved-searches/:id — update alert_on toggle
router.patch(
    '/:id',
    validate(savedSearchUpdateSchema),
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('saved_searches')
            .update({ alert_on: req.body.alert_on })
            .eq('id', savedSearchId(req))
            .eq('user_id', req.user.id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
        res.json({ success: true, data });
    }),
);

// DELETE /api/v1/saved-searches/:id
router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
        const { data, error } = await supabase
            .from('saved_searches')
            .delete()
            .eq('id', savedSearchId(req))
            .eq('user_id', req.user.id)
            .select('id');
        if (error) throw error;
        if (!data?.length) throw new HttpError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
        res.status(204).end();
    }),
);

module.exports = router;
