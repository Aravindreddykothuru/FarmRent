'use strict';

const router = require('express').Router();
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const { sendSuccess, createError } = require('../utils/helpers');
const { protect } = require('../middleware/authMiddleware');

// POST /api/v1/reviews — farmer submits review after booking completes
router.post('/', protect, async (req, res, next) => {
    try {
        const { bookingId, rating, reviewText } = req.body;
        if (!bookingId || !rating) {
            return next(createError(400, 'bookingId and rating are required'));
        }

        const booking = await Booking.findById(bookingId).populate('machine');
        if (!booking) return next(createError(404, 'Booking not found'));

        const farmerId = (req.user._id || req.user.id)?.toString();
        if (booking.renter?.toString() !== farmerId) {
            return next(createError(403, 'Only the farmer who made this booking can review it'));
        }
        if (!['completed', 'confirmed'].includes(booking.status)) {
            return next(createError(400, 'You can only review completed bookings'));
        }

        // Prevent duplicate reviews
        const existing = await Review.findOne({ bookingId });
        if (existing) return next(createError(409, 'You have already reviewed this booking'));

        const review = await Review.create({
            bookingId,
            machineId: booking.machine._id || booking.machine,
            reviewerId: farmerId,
            rating: Number(rating),
            reviewText: reviewText || '',
        });

        res.status(201).json({ success: true, data: review });
    } catch (err) { next(err); }
});

// GET /api/v1/reviews/machine/:machineId — public reviews for a machine
router.get('/machine/:machineId', async (req, res, next) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const [reviews, total] = await Promise.all([
            Review.find({ machineId: req.params.machineId })
                .populate('reviewerId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            Review.countDocuments({ machineId: req.params.machineId }),
        ]);

        sendSuccess(res, reviews, 'Success', 200, { total, page: Number(page), limit: Number(limit) });
    } catch (err) { next(err); }
});

module.exports = router;
