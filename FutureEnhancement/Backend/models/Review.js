'use strict';

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
    {
        rentalId: { type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentRental', required: true, unique: true },
        equipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
        reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        reviewText: { type: String, default: '', maxlength: 1000 },
    },
    { timestamps: true }
);

// After saving a review, recalculate equipment average rating
reviewSchema.post('save', async function () {
    try {
        const Equipment = mongoose.model('Equipment');
        const stats = await mongoose.model('Review').aggregate([
            { $match: { equipmentId: this.equipmentId } },
            { $group: { _id: '$equipmentId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]);
        if (stats.length > 0) {
            await Equipment.findByIdAndUpdate(this.equipmentId, {
                'ratings.average': Math.round(stats[0].avg * 10) / 10,
                'ratings.count': stats[0].count,
            });
        }
    } catch (e) { /* non-fatal */ }
});

module.exports = mongoose.model('Review', reviewSchema);
