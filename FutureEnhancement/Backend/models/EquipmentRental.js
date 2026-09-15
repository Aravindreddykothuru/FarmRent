'use strict';

const mongoose = require('mongoose');

const equipmentRentalSchema = new mongoose.Schema(
    {
        equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
        renter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },

        status: {
            type: String,
            enum: ['requested', 'approved', 'active', 'completed', 'cancelled', 'disputed'],
            default: 'requested',
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

        // Backward compatibility properties
        bookingId: { type: String, default: () => `BK${Date.now().toString(36).toUpperCase()}` },
        pricing: { finalAmount: Number },
        
        // For compatibility with code using machine
        get machine() {
            return this.equipment;
        },
        set machine(val) {
            this.equipment = val;
        }
    },
    { timestamps: true, collection: 'equipment_rentals' }
);

equipmentRentalSchema.index({ equipment: 1, startDate: 1, endDate: 1 });
equipmentRentalSchema.index({ renter: 1, status: 1 });

module.exports = mongoose.model('EquipmentRental', equipmentRentalSchema);
