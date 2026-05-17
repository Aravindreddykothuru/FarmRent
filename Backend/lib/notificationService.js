const supabase = require('./supabase');
const logger   = require('./logger');

let _getIo = null;

// Lazy-init to avoid circular require at startup
function getIo() {
    if (!_getIo) {
        _getIo = require('../services/tracking-service/socket').getIo;
    }
    try { return _getIo(); } catch { return null; }
}

/**
 * Persist a notification to DB and emit it in real-time via Socket.IO.
 * @param {string} userId
 * @param {{ type: string, title: string, message: string, data?: object }} payload
 */
async function sendNotification(userId, { type = 'system', title, message, data = {} }) {
    if (!userId || !title || !message) return null;

    let row = null;

    if (supabase) {
        try {
            const { data: inserted, error } = await supabase
                .from('notifications')
                .insert({ user_id: userId, type, title, message, data, is_read: false })
                .select()
                .single();
            if (!error) row = inserted;
        } catch (e) {
            logger.warn('[notification] DB insert failed', { error: e.message });
        }
    }

    // Real-time delivery — map DB fields to what NotificationBell expects
    const io = getIo();
    if (io) {
        try {
            const payload = row
                ? { ...row, _id: row.id, isRead: row.is_read, createdAt: row.created_at }
                : { _id: String(Date.now()), type, title, message, data, isRead: false, createdAt: new Date().toISOString() };
            io.of('/notifications').to(`user_${userId}`).emit('notification:new', payload);
        } catch (e) {
            logger.warn('[notification] Socket emit failed', { error: e.message });
        }
    }

    return row;
}

/**
 * Send a notification to multiple users at once.
 */
async function sendNotificationToMany(userIds, payload) {
    return Promise.all(userIds.map(uid => sendNotification(uid, payload)));
}

module.exports = { sendNotification, sendNotificationToMany };
