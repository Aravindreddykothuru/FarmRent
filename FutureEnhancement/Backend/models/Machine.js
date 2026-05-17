'use strict';

const mongoose = require('mongoose');

const machineSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        type: { type: String, required: true, lowercase: true, trim: true },
        description: { type: String, default: '' },
        status: { type: String, enum: ['available', 'booked', 'maintenance', 'inactive'], default: 'available' },
        isActive: { type: Boolean, default: true },
        isApproved: { type: Boolean, default: false },
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
            baseRatePerDay: { type: Number, required: true },
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
    { timestamps: true }
);

// Geospatial index for location-based queries
machineSchema.index({ 'location.coordinates': '2dsphere' });
machineSchema.index({ type: 1, status: 1, isActive: 1 });
machineSchema.index({ 'location.district': 1, 'location.state': 1 });
// Full-text search index for SearchService
machineSchema.index(
    { name: 'text', type: 'text', description: 'text', 'location.district': 'text' },
    { weights: { name: 10, type: 5, 'location.district': 3, description: 1 }, name: 'machine_text_index' }
);


module.exports = mongoose.model('Machine', machineSchema);
