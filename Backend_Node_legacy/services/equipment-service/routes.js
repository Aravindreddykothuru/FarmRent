const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const supabase = require('../../lib/supabase');
const { auth } = require('../../middleware/auth');
const { requireRole } = require('../../middleware/requireRole');
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

// ─── Adapter Mappers ────────────────────────────────────────────────────────
function mapEquipmentToClient(item) {
    if (!item) return item;
    const mapped = { ...item };

    // map daily_rate -> price_per_day
    if (mapped.daily_rate !== undefined) {
        mapped.price_per_day = Number(mapped.daily_rate);
    }
    // map category -> type
    if (mapped.category !== undefined) {
        mapped.type = mapped.category;
    }
    // map is_verified -> is_approved
    if (mapped.is_verified !== undefined) {
        mapped.is_approved = mapped.is_verified;
    }

    if (mapped.price_weekly !== undefined && mapped.price_weekly !== null) {
        mapped.price_weekly = Number(mapped.price_weekly);
    }
    if (mapped.price_monthly !== undefined && mapped.price_monthly !== null) {
        mapped.price_monthly = Number(mapped.price_monthly);
    }

    mapped.location = mapped.address_full || mapped.district || '';
    mapped.year = mapped.year_of_mfg || null;
    mapped.brand = mapped.brand || '';
    mapped.horsepower = mapped.horsepower || null;

    return mapped;
}

function mapEquipmentToDb(body) {
    const dbItem = {};
    const allowedKeys = [
        'name',
        'type',
        'description',
        'price_per_day',
        'location',
        'images',
        'horsepower',
        'year',
        'brand',
        'latitude',
        'longitude',
        'is_approved',
        'status',
        'category',
        'daily_rate',
        'is_verified',
        'address_full',
        'pincode',
        'village',
        'town',
        'service_radius_km',
        'service_pincodes',
        'price_weekly',
        'price_monthly',
        'is_deleted',
    ];

    for (const key of allowedKeys) {
        if (body[key] !== undefined) {
            if (key === 'price_per_day') dbItem.daily_rate = Number(body[key]);
            else if (key === 'type') dbItem.category = body[key];
            else if (key === 'is_approved') dbItem.is_verified = !!body[key];
            else if (key === 'year') dbItem.year_of_mfg = Number(body[key]);
            else if (key === 'location') dbItem.address_full = body[key];
            else if (key === 'horsepower' || key === 'brand') {
                // Ignore or omit as they don't exist in equipment table schema
            } else dbItem[key] = body[key];
        }
    }

    // Set location_point geography if lat/lng are set
    const lat = dbItem.latitude;
    const lng = dbItem.longitude;
    if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
        dbItem.location_point = `POINT(${Number(lng)} ${Number(lat)})`;
    }

    return dbItem;
}

// GET /api/v1/equipment — list all (with optional ?type=&location=&status= filters)
router.get(
    '/',
    asyncHandler(async (req, res) => {
        const { type, location, status, limit = 50, offset = 0 } = req.query;

        if (!requireDb(res)) return;

        let query = supabase
            .from('equipment')
            .select(
                'id, owner_id, name, category, description, daily_rate, images, status, is_verified, created_at, address_full, district, state, year_of_mfg, price_weekly, price_monthly, is_deleted',
            )
            .eq('is_verified', true)
            .eq('is_deleted', false);
        if (type) query = query.ilike('category', `%${type}%`);
        if (location) query = query.or(`address_full.ilike.%${location}%,district.ilike.%${location}%`);
        if (status) query = query.eq('status', status);
        query = query.order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit) - 1);

        const { data, error } = await query;
        if (error) throw error;

        const mapped = (data || []).map(mapEquipmentToClient);
        return res.json({ success: true, data: mapped, count: mapped.length });
    }),
);

// GET /api/v1/equipment/:id
router.get(
    '/:id',
    auth(false),
    asyncHandler(async (req, res) => {
        if (!requireDb(res)) return;
        const { data, error } = await supabase
            .from('equipment')
            .select(
                'id, owner_id, name, category, description, daily_rate, latitude, longitude, images, status, is_verified, created_at, address_full, district, state, year_of_mfg, price_weekly, price_monthly, is_deleted',
            )
            .eq('id', req.params.id)
            .eq('is_deleted', false)
            .single();
        if (error || !data) return res.status(404).json({ success: false, error: 'Equipment not found' });

        const userId = req.user?.id || req.user?.sub;
        let locationRevealed = false;
        if (userId) {
            if (String(data.owner_id) === String(userId)) {
                locationRevealed = true;
            } else {
                const { data: booking } = await supabase
                    .from('equipment_rentals')
                    .select('id')
                    .eq('equipment_id', req.params.id)
                    .eq('renter_id', userId)
                    .in('status', ['approved', 'active', 'completed'])
                    .maybeSingle();
                locationRevealed = !!booking;
            }
        }

        const clientData = mapEquipmentToClient(data);
        const response = locationRevealed ? clientData : { ...clientData, latitude: null, longitude: null };
        return res.json({ success: true, data: response, location_revealed: locationRevealed });
    }),
);

// POST /api/v1/equipment — add new listing
router.post(
    '/',
    auth(true),
    requireRole('owner', 'farmer', 'admin'),
    validate(equipmentCreateSchema),
    asyncHandler(async (req, res) => {
        const { name, type, price_per_day } = req.body || {};
        if (!name || !type || !price_per_day) return res.status(400).json({ error: 'name, type and price_per_day are required' });

        const ownerId = req.user?.id || req.user?.sub || null;

        if (!requireDb(res)) return;

        const dbPayload = mapEquipmentToDb({
            ...req.body,
            owner_id: ownerId,
        });

        const { data, error } = await supabase
            .from('equipment')
            .insert({
                ...dbPayload,
                owner_id: ownerId,
            })
            .select()
            .single();
        if (error) throw error;
        return res.status(201).json({ success: true, data: mapEquipmentToClient(data) });
    }),
);

// PATCH /api/v1/equipment/:id
router.patch(
    '/:id',
    auth(true),
    requireRole('owner', 'farmer', 'admin'),
    validate(equipmentUpdateSchema),
    asyncHandler(async (req, res) => {
        const existing = await ensureOwner(req, res, req.params.id);
        if (!existing) return;

        const dbPayload = mapEquipmentToDb(req.body);

        const { data, error } = await supabase.from('equipment').update(dbPayload).eq('id', req.params.id).select().single();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Equipment not found' });
        return res.json({ success: true, data: mapEquipmentToClient(data) });
    }),
);

// DELETE /api/v1/equipment/:id
router.delete(
    '/:id',
    auth(true),
    requireRole('owner', 'farmer', 'admin'),
    asyncHandler(async (req, res) => {
        const existing = await ensureOwner(req, res, req.params.id);
        if (!existing) return;
        const { error } = await supabase
            .from('equipment')
            .update({ is_deleted: true, status: 'unavailable', updated_at: new Date().toISOString() })
            .eq('id', req.params.id);
        if (error) throw error;
        return res.json({ success: true, message: 'Equipment deleted' });
    }),
);

// POST /api/v1/equipment/upload-images — upload multiple images (up to 10, max 5MB each)
const multer = require('multer');
const imagesUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

router.post(
    '/upload-images',
    auth(true),
    requireRole('owner', 'farmer', 'admin'),
    imagesUpload.array('images', 10),
    asyncHandler(async (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No files uploaded' });
        }

        const { validateBufferMagicNumber, ALLOWED_IMAGE_MIMES } = require('../../middleware/validateFileType');
        const { uploadToS3 } = require('../../lib/s3Storage');
        const crypto = require('crypto');
        const path = require('path');

        const urls = [];
        try {
            for (const file of req.files) {
                // Validate file content type using magic bytes
                const isValid = await validateBufferMagicNumber(file.buffer, ALLOWED_IMAGE_MIMES);
                if (!isValid) {
                    return res.status(400).json({ status: 'error', message: `Invalid image content in file ${file.originalname}` });
                }

                const hash = crypto.randomBytes(8).toString('hex');
                const uniqueKey = `equipment-images/${req.user.id}-${Date.now()}-${hash}${path.extname(file.originalname) || '.jpg'}`;

                const imageUrl = await uploadToS3(uniqueKey, file.buffer, file.mimetype);
                urls.push(imageUrl);
            }

            return res.json({ success: true, urls });
        } catch (uploadError) {
            console.error('[equipment-images] Upload failed:', uploadError.message);
            return res.status(500).json({ status: 'error', message: 'Failed to upload images' });
        }
    }),
);

module.exports = router;
