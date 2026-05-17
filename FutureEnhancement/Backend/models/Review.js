'use strict';

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
    {
        bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
        machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
        reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        reviewText: { type: String, default: '', maxlength: 1000 },
    },
    { timestamps: true }
);

// After saving a review, recalculate machine average rating
reviewSchema.post('save', async function () {
    try {
        const Machine = mongoose.model('Machine');
        const stats = await mongoose.model('Review').aggregate([
            { $match: { machineId: this.machineId } },
            { $group: { _id: '$machineId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]);
        if (stats.length > 0) {
            await Machine.findByIdAndUpdate(this.machineId, {
                'ratings.average': Math.round(stats[0].avg * 10) / 10,
                'ratings.count': stats[0].count,
            });
        }
    } catch (e) { /* non-fatal */ }
});

module.exports = mongoose.model('Review', reviewSchema);
