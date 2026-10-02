/**
 * Backend/lib/notificationService.js
 *
 * Enqueues notifications to be processed asynchronously by the notification queue worker.
 * Prevents the calling HTTP request thread from waiting for database writes or WebSocket emissions.
 */

const { pushToQueue } = require('./notificationQueue');

/**
 * Enqueue a notification for real-time Socket.IO emission and database persistence.
 * Returns immediately (fire-and-forget).
 * @param {string} userId
 * @param {{ type: string, title: string, message: string, data?: object }} payload
 */
async function sendNotification(userId, payload) {
    if (!userId || !payload || !payload.title || !payload.message) return false;
    pushToQueue(userId, payload);
    return true;
}

/**
 * Enqueue a notification to multiple users at once.
 * Returns immediately (fire-and-forget).
 * @param {string[]} userIds
 * @param {{ type: string, title: string, message: string, data?: object }} payload
 */
async function sendNotificationToMany(userIds, payload) {
    if (!Array.isArray(userIds) || userIds.length === 0 || !payload) return false;
    userIds.forEach((uid) => pushToQueue(uid, payload));
    return true;
}

module.exports = { sendNotification, sendNotificationToMany };
