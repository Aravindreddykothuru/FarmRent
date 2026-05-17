'use strict';

const router = require('express').Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { sendSuccess, createError } = require('../utils/helpers');

/**
 * Notification utilities — also exported so other routes can call them
 */
const notifyUser = async (userId, type, title, message, data = {}) => {
    try {
        const n = await Notification.create({ userId, type, title, message, data });
        return n;
    } catch (e) {
        console.error('Notification create error:', e.message);
    }
};
module.exports.notifyUser = notifyUser;

// GET /api/v1/notifications — list my notifications (newest first, max 50)
router.get('/', protect, async (req, res, next) => {
    try {
        const { page = 1, limit = 20, unread } = req.query;
        const userId = req.user._id || req.user.id;
        const filter = { userId };
        if (unread === 'true') filter.isRead = false;

        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit)),
            Notification.countDocuments(filter),
            Notification.countDocuments({ userId, isRead: false }),
        ]);

        sendSuccess(res, { notifications, total, unreadCount, page: Number(page) });
    } catch (err) { next(err); }
});

// PATCH /api/v1/notifications/:id/read — mark one as read
router.patch('/:id/read', protect, async (req, res, next) => {
    try {
        const userId = req.user._id || req.user.id;
        const n = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId },
            { isRead: true },
            { new: true }
        );
        if (!n) return next(createError(404, 'Notification not found'));
        sendSuccess(res, n);
    } catch (err) { next(err); }
});

// PATCH /api/v1/notifications/read-all — mark all as read
router.patch('/read-all', protect, async (req, res, next) => {
    try {
        const userId = req.user._id || req.user.id;
        await Notification.updateMany({ userId, isRead: false }, { isRead: true });
        sendSuccess(res, { message: 'All notifications marked as read' });
    } catch (err) { next(err); }
});

// DELETE /api/v1/notifications/:id — delete one notification
router.delete('/:id', protect, async (req, res, next) => {
    try {
        const userId = req.user._id || req.user.id;
        await Notification.findOneAndDelete({ _id: req.params.id, userId });
        sendSuccess(res, { message: 'Notification deleted' });
    } catch (err) { next(err); }
});

// Export the router as .router so server.js can use it
const notificationRouter = router;
module.exports.router = notificationRouter;
