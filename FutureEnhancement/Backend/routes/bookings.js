'use strict';

const router = require('express').Router();
const Booking = require('../models/Booking');
const Machine = require('../models/Machine');
const { sendSuccess, createError } = require('../utils/helpers');
const { protect } = require('../middleware/authMiddleware');
const { notifyUser } = require('./notifications');

// GET /api/v1/bookings/availability/:machineId
// Returns all booked date ranges so the frontend calendar can disable them
router.get('/availability/:machineId', async (req, res, next) => {
    try {
        const { machineId } = req.params;
        const { from, to } = req.query;
        const filter = {
            machine: machineId,
            status: { $in: ['pending', 'confirmed', 'in_progress'] },
        };
        if (from && to) {
            filter.$or = [
                { startDate: { $lte: new Date(to) }, endDate: { $gte: new Date(from) } },
            ];
        }
        const bookings = await Booking.find(filter).select('startDate endDate status').lean();
        sendSuccess(res, bookings.map(b => ({ start: b.startDate, end: b.endDate, status: b.status })));
    } catch (err) { next(err); }
});


// POST /api/v1/bookings — farmer creates a booking request
router.post('/', protect, async (req, res, next) => {
    try {
        const { machineId, startDate, endDate, totalAmount, paymentMethod, notes } = req.body;

        if (!machineId || !startDate || !endDate || !totalAmount) {
            return next(createError(400, 'machineId, startDate, endDate, and totalAmount are required'));
        }

        const machine = await Machine.findById(machineId).lean();
        if (!machine) return next(createError(404, 'Machine not found'));
        if (machine.status !== 'available') {
            return next(createError(409, 'Machine is not currently available'));
        }

        const serviceFee = Math.round(Number(totalAmount) * 0.1);
        const booking = await Booking.create({
            machine: machineId,
            renter: req.user._id || req.user.id,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            totalAmount: Number(totalAmount),
            serviceFee,
            paymentMethod: paymentMethod || 'upi',
            paymentStatus: 'pending',
            status: 'pending',
            notes: notes || '',
        });

        await Machine.findByIdAndUpdate(machineId, { status: 'booked', $inc: { totalBookings: 1 } });

        res.status(201).json({ success: true, data: booking });
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/my — farmer sees their own bookings
router.get('/my', protect, async (req, res, next) => {
    try {
        const renterId = req.user._id || req.user.id;
        const bookings = await Booking.find({ renter: renterId })
            .populate('machine', 'name type location pricing ratings images')
            .sort({ createdAt: -1 })
            .lean();
        sendSuccess(res, bookings);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/incoming — owner sees pending/confirmed bookings on their machines
router.get('/incoming', protect, async (req, res, next) => {
    try {
        const ownerId = req.user._id || req.user.id;
        // Find machine IDs that belong to this owner
        const myMachines = await Machine.find({ owner: ownerId }).select('_id name').lean();
        const machineIds = myMachines.map((m) => m._id);

        const { status } = req.query;
        const filter = { machine: { $in: machineIds } };
        if (status) filter.status = status;

        const bookings = await Booking.find(filter)
            .populate('machine', 'name type location pricing')
            .populate('renter', 'name email phone')
            .sort({ createdAt: -1 })
            .lean();

        sendSuccess(res, bookings);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings/:id — get single booking
router.get('/:id', protect, async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('machine', 'name type location pricing')
            .populate('renter', 'name email phone')
            .lean();
        if (!booking) return next(createError(404, 'Booking not found'));
        sendSuccess(res, booking);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/accept — owner accepts booking
router.patch('/:id/accept', protect, async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('machine');
        if (!booking) return next(createError(404, 'Booking not found'));

        const ownerId = (req.user._id || req.user.id)?.toString();
        if (booking.machine.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can accept this booking'));
        }
        if (booking.status !== 'pending') {
            return next(createError(400, `Cannot accept a booking with status: ${booking.status}`));
        }

        booking.status = 'confirmed';
        await booking.save();

        // Emit real-time update
        const io = req.app.get('io');
        if (io) io.to(`booking:${booking._id}`).emit('booking:updated', { id: booking._id, status: 'confirmed' });

        sendSuccess(res, booking);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/reject — owner rejects booking
router.patch('/:id/reject', protect, async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('machine');
        if (!booking) return next(createError(404, 'Booking not found'));

        const ownerId = (req.user._id || req.user.id)?.toString();
        if (booking.machine.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can reject this booking'));
        }

        booking.status = 'cancelled';
        await booking.save();

        // Free up the machine
        await Machine.findByIdAndUpdate(booking.machine._id, { status: 'available' });

        const io = req.app.get('io');
        if (io) io.to(`booking:${booking._id}`).emit('booking:updated', { id: booking._id, status: 'cancelled' });

        sendSuccess(res, booking);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/confirm — owner confirms booking (legacy alias)
router.patch('/:id/confirm', protect, async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('machine');
        if (!booking) return next(createError(404, 'Booking not found'));

        // Verify user is the machine owner
        const ownerId = (req.user._id || req.user.id)?.toString();
        if (booking.machine.owner?.toString() !== ownerId && req.user.role !== 'admin') {
            return next(createError(403, 'Only the equipment owner can confirm this booking'));
        }

        booking.status = 'confirmed';
        booking.paymentStatus = 'paid';
        await booking.save();

        sendSuccess(res, booking);
    } catch (err) { next(err); }
});

// PATCH /api/v1/bookings/:id/cancel — farmer cancels OR owner rejects
router.patch('/:id/cancel', protect, async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id).populate('machine');
        if (!booking) return next(createError(404, 'Booking not found'));
        if (['completed', 'cancelled'].includes(booking.status)) {
            return next(createError(400, `Cannot cancel a ${booking.status} booking`));
        }

        booking.status = 'cancelled';
        await booking.save();
        // Release machine back to available
        await Machine.findByIdAndUpdate(booking.machine._id, { status: 'available' });

        sendSuccess(res, booking);
    } catch (err) { next(err); }
});

// GET /api/v1/bookings — admin: all bookings
router.get('/', protect, async (req, res, next) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const filter = status ? { status } : {};
        const skip = (Number(page) - 1) * Number(limit);
        const [data, total] = await Promise.all([
            Booking.find(filter).skip(skip).limit(Number(limit))
                .populate('machine', 'name type location')
                .populate('renter', 'name email')
                .sort({ createdAt: -1 }).lean(),
            Booking.countDocuments(filter),
        ]);
        sendSuccess(res, data, { total, page: Number(page), limit: Number(limit) });
    } catch (err) { next(err); }
});

module.exports = router;
