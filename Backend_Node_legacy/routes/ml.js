/**
 * Market insight endpoints — /api/v1/ml
 *
 * Computed directly from marketplace data. No model is trained yet, so responses describe what the
 * data shows (booking history, market averages) and say so in `source`; nothing is invented.
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const supabase = require('../lib/supabase');
const { HttpError } = require('../lib/httpError');
const { asyncHandler } = require('../middleware/asyncHandler');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/requireRole');
const { validate } = require('../middleware/validate');

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

// Free text is placed inside PostgREST filters, whose syntax uses , ( ) . and quotes.
const searchTerm = (value) =>
    String(value || '')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

function demandLevel(count, peak) {
    if (peak === 0) return 'None';
    const share = count / peak;
    if (share >= 0.8) return 'Peak';
    if (share >= 0.5) return 'High';
    if (share >= 0.2) return 'Medium';
    return 'Low';
}

// GET /api/v1/ml/demand-prediction?type=tractor&district=Kurnool
// Rental starts per month over the last 12 months — the seasonal demand signal for a category/area.
router.get(
    '/demand-prediction',
    asyncHandler(async (req, res) => {
        const type = searchTerm(req.query.type);
        const district = searchTerm(req.query.district);

        const since = new Date();
        since.setUTCDate(1);
        since.setUTCMonth(since.getUTCMonth() - 11);
        const sinceIso = since.toISOString().slice(0, 10);

        let query = db()
            .from('equipment_rentals')
            .select('start_date, equipment!inner(category, district)')
            .gte('start_date', sinceIso)
            .not('status', 'in', '(cancelled,rejected)')
            .limit(20000);
        if (type) query = query.ilike('equipment.category', `%${type}%`);
        if (district) query = query.ilike('equipment.district', `%${district}%`);
        const { data, error } = await query;
        if (error) throw error;

        const counts = new Map();
        for (let i = 0; i < 12; i += 1) {
            const month = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1));
            counts.set(month.toISOString().slice(0, 7), 0);
        }
        for (const row of data || []) {
            const key = row.start_date.slice(0, 7);
            if (counts.has(key)) counts.set(key, counts.get(key) + 1);
        }
        const peak = Math.max(...counts.values());

        return res.json({
            success: true,
            demand: [...counts].map(([month, bookings]) => ({
                month,
                label: MONTH_LABELS[Number(month.slice(5, 7)) - 1],
                bookings,
                level: demandLevel(bookings, peak),
            })),
            meta: { type: type || 'all', district: district || 'all', source: 'booking_history', months: 12 },
        });
    }),
);

// GET /api/v1/ml/recommendations — best-rated listings currently available
router.get(
    '/recommendations',
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('equipment')
            .select('id, name, category, daily_rate, images, avg_rating, rating_count, district')
            .eq('status', 'active')
            .eq('is_verified', true)
            .eq('is_deleted', false)
            .order('avg_rating', { ascending: false })
            .order('rating_count', { ascending: false })
            .limit(6);
        if (error) throw error;

        return res.json({
            success: true,
            recommendations: (data || []).map((item) => ({ ...item, type: item.category, price_per_day: Number(item.daily_rate) })),
            source: 'top_rated',
        });
    }),
);

const optimalPricingSchema = z.object({
    type: z.string().trim().max(50).optional(),
    district: z.string().trim().max(100).optional(),
    days: z.coerce.number().int().min(1).max(90).default(1),
});

// POST /api/v1/ml/optimal-pricing — average daily rate of comparable live listings
router.post(
    '/optimal-pricing',
    validate(optimalPricingSchema),
    asyncHandler(async (req, res) => {
        const type = searchTerm(req.body.type);
        const district = searchTerm(req.body.district);

        let query = db().from('equipment').select('daily_rate').eq('status', 'active').eq('is_verified', true).eq('is_deleted', false);
        if (type) query = query.ilike('category', `%${type}%`);
        if (district) query = query.ilike('district', `%${district}%`);
        const { data, error } = await query.limit(200);
        if (error) throw error;

        const rates = (data || []).map((r) => Number(r.daily_rate)).filter((r) => r > 0);
        const average = rates.length ? Math.round(rates.reduce((s, r) => s + r, 0) / rates.length) : null;

        return res.json({
            success: true,
            suggestedPricePerDay: average,
            totalEstimate: average === null ? null : average * req.body.days,
            comparables: rates.length,
            confidence: rates.length >= 10 ? 'high' : rates.length >= 3 ? 'medium' : rates.length ? 'low' : 'none',
            source: 'market_average',
        });
    }),
);

// GET /api/v1/ml/churn-risk — admin only: share of users with no rental activity in the last 30 days
router.get(
    '/churn-risk',
    auth(true),
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const [{ count: totalUsers, error: usersError }, { data: recent, error: rentalsError }] = await Promise.all([
            db().from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null),
            db().from('equipment_rentals').select('renter_id').gte('created_at', since).limit(50000),
        ]);
        if (usersError) throw usersError;
        if (rentalsError) throw rentalsError;

        const activeRenters = new Set((recent || []).map((r) => r.renter_id).filter(Boolean)).size;
        const risk = totalUsers ? Math.round(((totalUsers - activeRenters) / totalUsers) * 100) : 0;
        return res.json({
            success: true,
            risk,
            label: risk > 60 ? 'High' : risk > 30 ? 'Medium' : 'Low',
            activeRenters,
            totalUsers: totalUsers || 0,
            source: 'activity_last_30_days',
        });
    }),
);

module.exports = router;
