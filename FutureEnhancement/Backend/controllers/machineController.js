'use strict';

const Equipment = require('../models/Equipment');
const { sendSuccess, createError } = require('../utils/helpers');
const catchAsync = require('../middleware/catchAsync');
const cache = require('../utils/cacheManager');

// Helper to map equipment to backward-compatible format for frontend
const mapToLegacy = (eq) => {
    if (!eq) return null;
    const doc = eq.toObject ? eq.toObject() : eq;
    return {
        ...doc,
        type: doc.category,
        isApproved: doc.isVerified,
        pricing: doc.pricing ? {
            ...doc.pricing,
            baseRatePerDay: doc.pricing.dailyRate
        } : undefined
    };
};

/**
 * Get all machines/equipment with optional filters (Supports Caching)
 * GET /api/v1/machines
 */
exports.getMachines = catchAsync(async (req, res, next) => {
    const {
        type, category, district, state, minPrice, maxPrice,
        status = 'available', page = 1, limit = 20,
        owner,
    } = req.query;

    const cacheKey = cache.buildSearchKey('machines:list', req.query);
    const cached = await cache.get(cacheKey);
    if (cached && owner !== 'me') {
        return sendSuccess(res, cached.data, 'Success', 200);
    }

    const filter = { isActive: true };
    const targetCategory = category || type;
    if (targetCategory) filter.category = targetCategory;
    if (status) filter.status = status;
    if (district) filter['location.district'] = new RegExp(district, 'i');
    if (state) filter['location.state'] = new RegExp(state, 'i');
    
    if (minPrice || maxPrice) {
        filter['pricing.dailyRate'] = {};
        if (minPrice) filter['pricing.dailyRate'].$gte = Number(minPrice);
        if (maxPrice) filter['pricing.dailyRate'].$lte = Number(maxPrice);
    }

    // owner=me — return only this user's machines
    if (owner === 'me' && req.user?.id) {
        filter.owner = req.user.id;
        delete filter.status;
        delete filter.isActive;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
        Equipment.find(filter).skip(skip).limit(Number(limit)).lean(),
        Equipment.countDocuments(filter),
    ]);

    const mappedData = data.map(mapToLegacy);
    const result = { data: mappedData, total, page: Number(page), limit: Number(limit) };

    if (owner !== 'me') {
        await cache.set(cacheKey, result, cache.defaultTTL);
    }

    sendSuccess(res, mappedData, 'Success', 200, { total, page: Number(page), limit: Number(limit) });
});

/**
 * Get single machine/equipment by ID
 * GET /api/v1/machines/:id
 */
exports.getMachine = catchAsync(async (req, res, next) => {
    const equipment = await Equipment.findById(req.params.id).lean();
    if (!equipment) return next(createError('Equipment not found', 404));
    sendSuccess(res, mapToLegacy(equipment));
});

/**
 * Create a new machine/equipment
 * POST /api/v1/machines
 */
exports.createMachine = catchAsync(async (req, res, next) => {
    const {
        name, type, category, description, pricing, location,
        specifications, features, status,
    } = req.body;

    const finalCategory = category || type;
    if (!finalCategory) {
        return next(createError('Category/type is required', 400));
    }

    const rate = Number(pricing.dailyRate || pricing.baseRatePerDay);
    const equipment = await Equipment.create({
        name,
        category: finalCategory,
        description,
        owner: req.user._id || req.user.id,
        pricing: {
            dailyRate: rate,
            baseRatePerHour: Number(pricing.baseRatePerHour || Math.round(rate / 8)),
            securityDeposit: Number(pricing.securityDeposit || 0),
            operatorIncluded: Boolean(pricing.operatorIncluded),
        },
        location: {
            district: location.district,
            state: location.state || '',
            village: location.village || '',
            coordinates: location.coordinates || undefined,
        },
        specifications: specifications || {},
        features: features || [],
        status: status || 'available',
        isActive: true,
        isVerified: true, // auto-approve for now
        ratings: { average: 0, count: 0 },
        totalBookings: 0,
    });

    // Invalidate cached lists
    await cache.invalidatePattern('machines:list*');

    res.status(201).json({ success: true, data: mapToLegacy(equipment) });
});

/**
 * Update machine/equipment
 * PATCH /api/v1/machines/:id
 */
exports.updateMachine = catchAsync(async (req, res, next) => {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) return next(createError('Equipment not found', 404));

    const ownerId = (req.user._id || req.user.id)?.toString();
    if (equipment.owner?.toString() !== ownerId && req.user.role !== 'admin') {
        return next(createError('You do not own this equipment', 403));
    }

    // Map fields for update
    const updateData = { ...req.body };
    if (updateData.type) {
        updateData.category = updateData.type;
        delete updateData.type;
    }
    if (updateData.isApproved !== undefined) {
        updateData.isVerified = updateData.isApproved;
        delete updateData.isApproved;
    }
    if (updateData.pricing) {
        if (updateData.pricing.baseRatePerDay !== undefined) {
            updateData.pricing.dailyRate = updateData.pricing.baseRatePerDay;
        }
    }

    const updated = await Equipment.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).lean();

    // Invalidate cache
    await cache.invalidatePattern('machines:list*');

    sendSuccess(res, mapToLegacy(updated));
});

/**
 * Soft delete machine/equipment
 * DELETE /api/v1/machines/:id
 */
exports.deleteMachine = catchAsync(async (req, res, next) => {
    const equipment = await Equipment.findById(req.params.id);
    if (!equipment) return next(createError('Equipment not found', 404));

    const ownerId = (req.user._id || req.user.id)?.toString();
    if (equipment.owner?.toString() !== ownerId && req.user.role !== 'admin') {
        return next(createError('You do not own this equipment', 403));
    }

    await Equipment.findByIdAndUpdate(req.params.id, { isActive: false });

    // Invalidate cache
    await cache.invalidatePattern('machines:list*');

    res.status(204).send();
});
