'use strict';

const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
    {
        machine: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
        renter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },

        status: {
            type: String,
            enum: ['pending', 'confirmed', 'active', 'completed', 'cancelled'],
            default: 'pending',
        },

        totalAmount: { type: Number, required: true },
        serviceFee: { type: Number, default: 0 },
        securityDeposit: { type: Number, default: 0 },

        paymentMethod: {
            type: String,
            enum: ['upi', 'card', 'netbanking', 'cash'],
            default: 'upi',
        },
        paymentStatus: {
            type: String,
            enum: ['pending', 'paid', 'refunded', 'failed'],
            default: 'pending',
        },
        transactionId: { type: String, default: '' },
        notes: { type: String, default: '' },

        // Legacy fields kept for backward compat
        bookingId: { type: String, default: () => `BK${Date.now().toString(36).toUpperCase()}` },
        pricing: { finalAmount: Number },
    },
    { timestamps: true }
);

bookingSchema.index({ machine: 1, startDate: 1, endDate: 1 });
bookingSchema.index({ renter: 1, status: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
