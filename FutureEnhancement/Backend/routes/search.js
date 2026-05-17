'use strict';

const router = require('express').Router();
const SearchService = require('../utils/searchService');
const { sendSuccess } = require('../utils/helpers');

/**
 * Search routes — powered by NFR SearchService
 * All routes under /api/v1/search
 */

// GET /api/v1/search/machines?q=&type=&district=&minPrice=&maxPrice=&minRating=&lat=&lng=&radius=&page=&limit=&sort=
router.get('/machines', async (req, res, next) => {
    try {
        const result = await SearchService.searchMachines(req.query);
        sendSuccess(res, result);
    } catch (err) {
        next(err);
    }
});

// GET /api/v1/search/autocomplete?q=
router.get('/autocomplete', async (req, res, next) => {
    try {
        const suggestions = await SearchService.autocomplete(req.query.q, parseInt(req.query.limit) || 5);
        sendSuccess(res, suggestions);
    } catch (err) {
        next(err);
    }
});

// GET /api/v1/search/nearby?lat=&lng=&radius=&limit=
router.get('/nearby', async (req, res, next) => {
    try {
        const { lat, lng, radius = 25, limit = 10 } = req.query;
        if (!lat || !lng) return res.status(400).json({ success: false, message: 'lat and lng are required' });
        const results = await SearchService.searchNearby(
            parseFloat(lat), parseFloat(lng), parseFloat(radius), parseInt(limit)
        );
        sendSuccess(res, results);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
