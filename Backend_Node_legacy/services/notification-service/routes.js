const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const supabase = require('../../lib/supabase');
const { HttpError } = require('../../lib/httpError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

function notificationId(req) {
    if (!UUID_RE.test(req.params.id)) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    return req.params.id;
}

// Map DB row → shape expected by NotificationBell.tsx
function toClient(row) {
    return {
        _id: row.id,
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        isRead: row.is_read,
        createdAt: row.created_at,
        data: row.data || {},
    };
}

// GET /api/v1/notifications
router.get(
    '/',
    asyncHandler(async (req, res) => {
        const [{ data, error }, { count: unreadCount, error: countError }] = await Promise.all([
            db().from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(30),
            db().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('is_read', false),
        ]);
        if (error) throw error;
        if (countError) throw countError;

        return res.json({ success: true, notifications: (data || []).map(toClient), unreadCount: unreadCount ?? 0 });
    }),
);

// PATCH /api/v1/notifications/read-all  (must be before /:id to avoid route conflict)
router.patch(
    '/read-all',
    asyncHandler(async (req, res) => {
        const { error } = await db().from('notifications').update({ is_read: true }).eq('user_id', req.user.id).eq('is_read', false);
        if (error) throw error;

        return res.json({ success: true });
    }),
);

// PATCH /api/v1/notifications/:id/read
router.patch(
    '/:id/read',
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notificationId(req))
            .eq('user_id', req.user.id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');

        return res.json({ success: true, notification: toClient(data) });
    }),
);

// DELETE /api/v1/notifications/:id
router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
        const { data, error } = await db()
            .from('notifications')
            .delete()
            .eq('id', notificationId(req))
            .eq('user_id', req.user.id)
            .select('id');
        if (error) throw error;
        if (!data?.length) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');

        return res.json({ success: true });
    }),
);

module.exports = router;
