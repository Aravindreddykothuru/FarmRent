'use strict';

const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        category: { type: String, required: true, lowercase: true, trim: true },
        description: { type: String, default: '' },
        status: { type: String, enum: ['available', 'booked', 'maintenance', 'inactive'], default: 'available' },
        isActive: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

        location: {
            village: { type: String, default: '' },
            district: { type: String, required: true },
            state: { type: String, default: '' },
            coordinates: {
                type: { type: String, enum: ['Point'], default: 'Point' },
                coordinates: { type: [Number], default: undefined },  // [lng, lat]
            },
        },

        pricing: {
            dailyRate: { type: Number, required: true },
            baseRatePerHour: { type: Number, default: 0 },
            securityDeposit: { type: Number, default: 0 },
            operatorIncluded: { type: Boolean, default: false },
        },

        specifications: { type: mongoose.Schema.Types.Mixed, default: {} },
        images: { type: [String], default: [] },
        features: { type: [String], default: [] },

        ratings: {
            average: { type: Number, default: 0 },
            count: { type: Number, default: 0 },
        },
        totalBookings: { type: Number, default: 0 },

        availability: {
            workingDays: { type: [String], default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
            defaultStartTime: { type: String, default: '06:00' },
            defaultEndTime: { type: String, default: '18:00' },
            blackoutDates: { type: [Date], default: [] },
        },
    },
    { timestamps: true, collection: 'equipment' }
);

// Geospatial index for location-based queries
equipmentSchema.index({ 'location.coordinates': '2dsphere' });
equipmentSchema.index({ category: 1, status: 1, isActive: 1 });
equipmentSchema.index({ 'location.district': 1, 'location.state': 1 });
// Full-text search index for SearchService
equipmentSchema.index(
    { name: 'text', category: 'text', description: 'text', 'location.district': 'text' },
    { weights: { name: 10, category: 5, 'location.district': 3, description: 1 }, name: 'equipment_text_index' }
);

module.exports = mongoose.model('Equipment', equipmentSchema);
