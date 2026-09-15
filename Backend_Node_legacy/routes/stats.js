const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const supabase = require('../lib/supabase');
const cacheManager = require('../lib/cacheManager');
const { HttpError } = require('../lib/httpError');

// GET /api/v1/stats — public platform totals for the landing page. Aggregate counts only; cached 5 minutes.
router.get(
    '/',
    asyncHandler(async (_req, res) => {
        if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');

        const stats = await cacheManager.remember('platform:stats', 300, async () => {
            const { data, error } = await supabase.rpc('public_platform_stats');
            if (error) throw error;
            return data;
        });

        return res.json({
            machines: Number(stats.machines),
            renters: Number(stats.renters),
            bookings: Number(stats.bookings),
            states: Number(stats.states),
        });
    }),
);

module.exports = router;
