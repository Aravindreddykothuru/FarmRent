const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const supabase = require('../lib/supabase');

// Map DB row → shape expected by NotificationBell.tsx
function toClient(row) {
    return {
        _id:       row.id,
        id:        row.id,
        type:      row.type,
        title:     row.title,
        message:   row.message,
        isRead:    row.is_read,
        createdAt: row.created_at,
        data:      row.data || {},
    };
}

// GET /api/v1/notifications
router.get('/', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true, notifications: [], unreadCount: 0 });

    const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

    if (error) throw error;

    const notifications = (data || []).map(toClient);
    const unreadCount = notifications.filter(n => !n.isRead).length;

    return res.json({ success: true, notifications, unreadCount });
}));

// PATCH /api/v1/notifications/read-all  (must be before /:id to avoid route conflict)
router.patch('/read-all', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true });

    await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', req.user.id)
        .eq('is_read', false);

    return res.json({ success: true });
}));

// PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true });

    const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select()
        .single();

    if (error) return res.status(404).json({ status: 'error', message: 'Notification not found' });

    return res.json({ success: true, notification: toClient(data) });
}));

// DELETE /api/v1/notifications/:id
router.delete('/:id', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true });

    await supabase
        .from('notifications')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.user.id);

    return res.json({ success: true });
}));

module.exports = router;
