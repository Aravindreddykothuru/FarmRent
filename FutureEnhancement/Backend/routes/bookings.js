'use strict';

const router = require('express').Router();
const EquipmentRental = require('../models/EquipmentRental');
const Equipment = require('../models/Equipment');
const { sendSuccess, createError } = require('../utils/helpers');
const { protect } = require('../middleware/authMiddleware');
const { notifyUser } = require('./notifications');

// GET /api/v1/bookings/availability/:equipmentId
// Returns all booked date ranges so the frontend calendar can disable them
router.get('/availability/:equipmentId', async (req, res, next) => {
    try {
        const { equipmentId } = req.params;
        const { from, to } = req.query;
        const filter = {
            equipment: equipmentId,
            status: { $in: ['pending', 'confirmed', 'in_progress', 'requested', 'approved', 'active'] },
        };
        if (from && to) {
            filter.$or = [
                { startDate: { $lte: new Date(to) }, endDate: { $gte: new Date(from) } },
            ];
        }
        const rentals = await EquipmentRental.find(filter).select('startDate endDate status').lean();
        sendSuccess(res, rentals.map(r => ({ start: r.startDate, end: r.endDate, status: r.status })));
    } catch (err) { next(err); }
});

// POST /api/v1/bookings — farmer creates a booking request
router.post('/', protect, async (req, res, next) => {
    try {
        const { equipmentId, machineId, startDate, endDate, totalAmount, paymentMethod, notes } = req.body;
        const targetId = equipmentId || machineId;

        if (!targetId || !startDate || !endDate || !totalAmount) {
            return next(createError(400, 'equipmentId, startDate, endDate, and totalAmount are required'));
        }

        const equipment = await Equipment.findById(targetId).lean();
        if (!equipment) return next(createError(404, 'Equipment not found'));
        if (equipment.status !== 'available') {
            return next(createError(409, 'Equipment is not currently available'));
        }

        const serviceFee = Math.round(Number(totalAmount) * 0.1);
        const rental = await EquipmentRental.create({
            equipment: targetId,
            renter: req.user._id || req.user.id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            totalAmount: Number(totalAmount),
            serviceFee,
            paymentMethod: paymentMethod || 'upi',
            paymentStatus: 'pending',
            status: 'requested',
            notes: notes || '',
        });

        await Equipment.findByIdAndUpdate(targetId, { status: 'booked', $inc: { totalBookings: 1 } });

        res.status(201).json({ success: true, data: rental });
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/my — farmer sees their own bookings
router.get('/my', protect, async (req, res, next) => {
    try {
        const renterId = req.user._id || req.user.id;
        const rentals = await EquipmentRental.find({ renter: renterId })
            .populate('equipment', 'name category location pricing ratings images')
            .sort({ createdAt: -1 })
            .lean();
        // Return mapped for backward compatibility with frontend
        const mapped = rentals.map(r => ({
            ...r,
            machine: r.equipment,
            machineId: r.equipment?._id
        }));
        sendSuccess(res, mapped);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/incoming — owner sees pending/confirmed bookings on their machines
router.get('/incoming', protect, async (req, res, next) => {
    try {
        const ownerId = req.user._id || req.user.id;
        // Find equipment IDs that belong to this owner
        const myEquipment = await Equipment.find({ owner: ownerId }).select('_id name').lean();
        const equipmentIds = myEquipment.map((e) => e._id);

        const { status } = req.query;
        // Map legacy pending/confirmed statuses if requested
        let queryStatus = status;
        if (status === 'pending') queryStatus = 'requested';
        else if (status === 'confirmed') queryStatus = 'approved';

        const filter = { equipment: { $in: equipmentIds } };
        if (queryStatus) filter.status = queryStatus;

        const rentals = await EquipmentRental.find(filter)
            .populate('equipment', 'name category location pricing')
            .populate('renter', 'fullName email phone')
            .sort({ createdAt: -1 })
            .lean();

        // Map for backward compatibility with frontend
        const mapped = rentals.map(r => ({
            ...r,
            machine: r.equipment,
            renter: r.renter ? {
                ...r.renter,
                name: r.renter.fullName
            } : null
        }));

        sendSuccess(res, mapped);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/:id — get single booking
router.get('/:id', protect, async (req, res, next) => {
    try {
        const rental = await EquipmentRental.findById(req.params.id)
            .populate('equipment', 'name category location pricing')
            .populate('renter', 'fullName email phone')
            .lean();
        if (!rental) return next(createError(404, 'Rental not found'));

        // Map for backward compatibility with frontend
        const mapped = {
            ...rental,
            machine: rental.equipment,
            renter: rental.renter ? {
                ...rental.renter,
                name: rental.renter.fullName
            } : null
        };
        sendSuccess(res, mapped);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/accept — owner accepts booking
router.patch('/:id/accept', protect, async (req, res, next) => {
    try {
        const rental = await EquipmentRental.findById(req.params.id).populate('equipment');
        if (!rental) return next(createError(404, 'Rental not found'));

        const ownerId = (req.user._id || req.user.id)?.toString();
        if (rental.equipment.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can accept this booking'));
        }
        if (rental.status !== 'requested') {
            return next(createError(400, `Cannot accept a booking with status: ${rental.status}`));
        }

        rental.status = 'approved';
        await rental.save();

        // Emit real-time update
        const io = req.app.get('io');
        if (io) io.to(`booking:${rental._id}`).emit('booking:updated', { id: rental._id, status: 'approved' });

        sendSuccess(res, rental);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/reject — owner rejects booking
router.patch('/:id/reject', protect, async (req, res, next) => {
    try {
        const rental = await EquipmentRental.findById(req.params.id).populate('equipment');
        if (!rental) return next(createError(404, 'Rental not found'));

        const ownerId = (req.user._id || req.user.id)?.toString();
        if (rental.equipment.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can reject this booking'));
        }

        rental.status = 'cancelled';
        await rental.save();

        // Free up the machine
        await Equipment.findByIdAndUpdate(rental.equipment._id, { status: 'available' });

        const io = req.app.get('io');
        if (io) io.to(`booking:${rental._id}`).emit('booking:updated', { id: rental._id, status: 'cancelled' });

        sendSuccess(res, rental);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/confirm — owner confirms booking (legacy alias)
router.patch('/:id/confirm', protect, async (req, res, next) => {
    try {
        const rental = await EquipmentRental.findById(req.params.id).populate('equipment');
        if (!rental) return next(createError(404, 'Rental not found'));

        const ownerId = (req.user._id || req.user.id)?.toString();
        if (rental.equipment.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can confirm this booking'));
        }

        rental.status = 'approved';
        rental.paymentStatus = 'paid';
        await rental.save();

        sendSuccess(res, rental);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/cancel — farmer cancels OR owner rejects
router.patch('/:id/cancel', protect, async (req, res, next) => {
    try {
        const rental = await EquipmentRental.findById(req.params.id).populate('equipment');
        if (!rental) return next(createError(404, 'Rental not found'));
        if (['completed', 'cancelled'].includes(rental.status)) {
            return next(createError(400, `Cannot cancel a ${rental.status} rental`));
        }

        rental.status = 'cancelled';
        await rental.save();
        // Release equipment back to available
        await Equipment.findByIdAndUpdate(rental.equipment._id, { status: 'available' });

        sendSuccess(res, rental);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings — admin: all bookings
router.get('/', protect, async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const filter = status ? { status } : {};
        const skip = (Number(page) - 1) * Number(limit);
        const [data, total] = await Promise.all([
            EquipmentRental.find(filter).skip(skip).limit(Number(limit))
                .populate('equipment', 'name category location')
                .populate('renter', 'fullName email')
                .sort({ createdAt: -1 }).lean(),
            EquipmentRental.countDocuments(filter),
        ]);

        const mapped = data.map(r => ({
            ...r,
            machine: r.equipment,
            renter: r.renter ? {
                ...r.renter,
                name: r.renter.fullName
            } : null
        }));

        sendSuccess(res, mapped, { total, page: Number(page), limit: Number(limit) });
    } catch (err) { next(err); }
});

module.exports = router;
