'use strict';

const Machine = require('../models/Machine');
const { sendSuccess, createError } = require('../utils/helpers');
const catchAsync = require('../middleware/catchAsync');
const cache = require('../utils/cacheManager');

/**
 * Get all machines with optional filters (Supports Caching)
 * GET /api/v1/machines
 */
exports.getMachines = catchAsync(async (req, res, next) => {
    const {
        type, district, state, minPrice, maxPrice,
        status = 'available', page = 1, limit = 20,
        owner,
    } = req.query;

    const cacheKey = cache.buildSearchKey('machines:list', req.query);
    const cached = await cache.get(cacheKey);
    if (cached && owner !== 'me') {
        return sendSuccess(res, cached.data, 'Success', 200);
    }

    const filter = { isActive: true };
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (district) filter['location.district'] = new RegExp(district, 'i');
    if (state) filter['location.state'] = new RegExp(state, 'i');
    if (minPrice || maxPrice) {
        filter['pricing.baseRatePerDay'] = {};
        if (minPrice) filter['pricing.baseRatePerDay'].$gte = Number(minPrice);
        if (maxPrice) filter['pricing.baseRatePerDay'].$lte = Number(maxPrice);
    }

    // owner=me — return only this user's machines
    if (owner === 'me' && req.user?.id) {
        filter.owner = req.user.id;
        delete filter.status;
        delete filter.isActive;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
        Machine.find(filter).skip(skip).limit(Number(limit)).lean(),
        Machine.countDocuments(filter),
    ]);

    const result = { data, total, page: Number(page), limit: Number(limit) };

    if (owner !== 'me') {
        await cache.set(cacheKey, result, cache.defaultTTL);
    }

    sendSuccess(res, data, 'Success', 200, { total, page: Number(page), limit: Number(limit) });
});

/**
 * Get single machine by ID
 * GET /api/v1/machines/:id
 */
exports.getMachine = catchAsync(async (req, res, next) => {
    const machine = await Machine.findById(req.params.id).lean();
    if (!machine) return next(createError('Machine not found', 404));
    sendSuccess(res, machine);
});

/**
 * Create a new machine
 * POST /api/v1/machines
 */
exports.createMachine = catchAsync(async (req, res, next) => {
    const {
        name, type, description, pricing, location,
        specifications, features, status,
    } = req.body;

    const machine = await Machine.create({
        name, type, description,
        owner: req.user._id || req.user.id,
        pricing: {
            baseRatePerDay: Number(pricing.baseRatePerDay),
            baseRatePerHour: Number(pricing.baseRatePerHour || Math.round(pricing.baseRatePerDay / 8)),
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
        isApproved: true, // auto-approve for now; admin can revoke
        ratings: { average: 0, count: 0 },
        totalBookings: 0,
    });

    // Invalidate cached lists
    await cache.invalidatePattern('machines:list*');

    res.status(201).json({ success: true, data: machine });
});

/**
 * Update machine
 * PATCH /api/v1/machines/:id
 */
exports.updateMachine = catchAsync(async (req, res, next) => {
    const machine = await Machine.findById(req.params.id);
    if (!machine) return next(createError('Machine not found', 404));

    const ownerId = (req.user._id || req.user.id)?.toString();
    if (machine.owner?.toString() !== ownerId && req.user.role !== 'admin') {
        return next(createError('You do not own this machine', 403));
    }

    const updated = await Machine.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).lean();

    // Invalidate cache
    await cache.invalidatePattern('machines:list*');

    sendSuccess(res, updated);
});

/**
 * Soft delete machine
 * DELETE /api/v1/machines/:id
 */
exports.deleteMachine = catchAsync(async (req, res, next) => {
    const machine = await Machine.findById(req.params.id);
    if (!machine) return next(createError('Machine not found', 404));

    const ownerId = (req.user._id || req.user.id)?.toString();
    if (machine.owner?.toString() !== ownerId && req.user.role !== 'admin') {
        return next(createError('You do not own this machine', 403));
    }

    await Machine.findByIdAndUpdate(req.params.id, { isActive: false });

    // Invalidate cache
    await cache.invalidatePattern('machines:list*');

    res.status(204).send();
});
