'use strict';

const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['booking_request', 'booking_confirmed', 'booking_rejected', 'booking_cancelled', 'payment_success', 'review_received', 'system'], required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },   // e.g. { bookingId, machineId }
    isRead: { type: Boolean, default: false, index: true },
}, { timestamps: true });

// Index for fast unread count queries
NotificationSchema.index({ userId: 1, isRead: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);
