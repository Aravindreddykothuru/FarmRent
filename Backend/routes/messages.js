const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const supabase = require('../lib/supabase');
const { sendNotification } = require('../lib/notificationService');

// Verify user is renter or owner of the booking
async function getBookingAndVerify(bookingId, userId) {
    const { data, error } = await supabase
        .from('bookings')
        .select('id, renter_id, owner_id, status')
        .eq('id', bookingId)
        .single();
    if (error || !data) return null;
    if (data.renter_id !== userId && data.owner_id !== userId) return null;
    return data;
}

// GET /api/v1/messages/:bookingId
router.get('/:bookingId', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ messages: [] });

    const booking = await getBookingAndVerify(req.params.bookingId, req.user.id);
    if (!booking) return res.status(403).json({ status: 'error', message: 'Access denied' });

    const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, content, is_read, created_at, users(name)')
        .eq('booking_id', req.params.bookingId)
        .order('created_at', { ascending: true });

    if (error) throw error;

    const messages = (data || []).map(m => ({
        id:         m.id,
        sender_id:  m.sender_id,
        sender_name: m.users?.name || 'Unknown',
        content:    m.content,
        is_read:    m.is_read,
        created_at: m.created_at,
        is_mine:    m.sender_id === req.user.id,
    }));

    // Mark unread messages sent by the other party as read
    const unreadIds = (data || [])
        .filter(m => !m.is_read && m.sender_id !== req.user.id)
        .map(m => m.id);
    if (unreadIds.length > 0) {
        supabase.from('messages').update({ is_read: true }).in('id', unreadIds).then(() => {}).catch(() => {});
    }

    return res.json({ messages });
}));

// POST /api/v1/messages/:bookingId
router.post('/:bookingId', asyncHandler(async (req, res) => {
    const { content } = req.body || {};
    if (!content?.trim()) return res.status(400).json({ status: 'error', message: 'Message content is required' });
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const booking = await getBookingAndVerify(req.params.bookingId, req.user.id);
    if (!booking) return res.status(403).json({ status: 'error', message: 'Access denied' });

    const { data, error } = await supabase
        .from('messages')
        .insert({
            booking_id: req.params.bookingId,
            sender_id:  req.user.id,
            content:    content.trim(),
            is_read:    false,
        })
        .select('id, sender_id, content, is_read, created_at')
        .single();

    if (error) throw error;

    // Notify the other party
    const recipientId = booking.renter_id === req.user.id ? booking.owner_id : booking.renter_id;
    if (recipientId) {
        sendNotification(recipientId, {
            type: 'system',
            title: 'New Message',
            message: content.trim().slice(0, 80),
            data: { bookingId: req.params.bookingId },
        }).catch(() => {});
    }

    // Real-time via Socket.IO tracking namespace
    try {
        const { getIo } = require('../services/tracking-service/socket');
        const io = getIo();
        io.of('/tracking').to(`booking_${req.params.bookingId}`).emit('message:new', {
            ...data,
            is_mine: false, // from recipient's perspective
            sender_id: req.user.id,
        });
    } catch { /* socket not initialized */ }

    return res.status(201).json({ success: true, message: { ...data, is_mine: true } });
}));

// PATCH /api/v1/messages/:bookingId/read
router.patch('/:bookingId/read', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true });

    const booking = await getBookingAndVerify(req.params.bookingId, req.user.id);
    if (!booking) return res.status(403).json({ status: 'error', message: 'Access denied' });

    await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('booking_id', req.params.bookingId)
        .neq('sender_id', req.user.id);

    return res.json({ success: true });
}));

/* ══════════════════════════════════════════════════════════════════════
   OLX-style chat routes (per-equipment, not per-booking)
   ══════════════════════════════════════════════════════════════════════ */

// GET /api/v1/messages/chats — user's chat inbox sorted by latest message
router.get('/chats', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ chats: [] });

    const userId = req.user.id;

    const { data: chatRows, error } = await supabase
        .from('chats')
        .select(`
            id,
            equipment_id,
            farmer_id,
            owner_id,
            equipment:equipment_id ( name, images ),
            farmer:farmer_id ( name, avatar_url ),
            owner:owner_id ( name, avatar_url, phone )
        `)
        .or(`farmer_id.eq.${userId},owner_id.eq.${userId}`)
        .order('created_at', { ascending: false });

    if (error) throw error;

    /* Fetch last message + unread count per chat */
    const chats = await Promise.all((chatRows || []).map(async (c) => {
        const { data: lastMsgs } = await supabase
            .from('messages')
            .select('content, created_at')
            .eq('chat_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1);

        const { count: unread } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('chat_id', c.id)
            .eq('is_read', false)
            .neq('sender_id', userId);

        const isFarmer = c.farmer_id === userId;
        const other = isFarmer ? c.owner : c.farmer;
        const otherId = isFarmer ? c.owner_id : c.farmer_id;

        return {
            id:               c.id,
            equipment_id:     c.equipment_id,
            equipment_name:   c.equipment?.name ?? 'Equipment',
            equipment_image:  c.equipment?.images?.[0] ?? null,
            other_user_id:    otherId,
            other_user_name:  other?.name ?? 'User',
            other_user_phone: isFarmer ? c.owner?.phone : null,
            other_user_avatar: other?.avatar_url ?? null,
            last_message:     lastMsgs?.[0]?.content ?? null,
            last_message_at:  lastMsgs?.[0]?.created_at ?? null,
            unread_count:     unread ?? 0,
        };
    }));

    /* Sort by most recent message */
    chats.sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
    });

    return res.json({ chats });
}));

// POST /api/v1/messages/chat/init — get or create a chat for equipment × farmer pair
router.post('/chat/init', asyncHandler(async (req, res) => {
    const { equipment_id, owner_id } = req.body || {};
    if (!equipment_id || !owner_id) {
        return res.status(400).json({ status: 'error', message: 'equipment_id and owner_id are required' });
    }
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const farmer_id = req.user.id;

    /* Prevent owner chatting with themselves */
    if (farmer_id === owner_id) {
        return res.status(400).json({ status: 'error', message: 'Cannot chat with yourself' });
    }

    /* Upsert: find existing or create */
    const { data: existing } = await supabase
        .from('chats')
        .select('id')
        .eq('equipment_id', equipment_id)
        .eq('farmer_id', farmer_id)
        .maybeSingle();

    if (existing) return res.json({ chat_id: existing.id });

    const { data: created, error } = await supabase
        .from('chats')
        .insert({ equipment_id, farmer_id, owner_id })
        .select('id')
        .single();

    if (error) throw error;
    return res.status(201).json({ chat_id: created.id });
}));

// GET /api/v1/messages/chat/:chatId — fetch chat messages
router.get('/chat/:chatId', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ messages: [] });

    const userId = req.user.id;
    const chatId = req.params.chatId;

    /* Verify membership */
    const { data: chat } = await supabase
        .from('chats').select('id,farmer_id,owner_id').eq('id', chatId).maybeSingle();
    if (!chat || (chat.farmer_id !== userId && chat.owner_id !== userId)) {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const { data, error } = await supabase
        .from('messages')
        .select('id, chat_id, sender_id, content, message_type, is_read, created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    if (error) throw error;

    /* Mark incoming messages as read */
    const unreadIds = (data || []).filter(m => !m.is_read && m.sender_id !== userId).map(m => m.id);
    if (unreadIds.length > 0) {
        supabase.from('messages').update({ is_read: true }).in('id', unreadIds).then(() => {}).catch(() => {});
    }

    return res.json({ messages: data || [] });
}));

// POST /api/v1/messages/chat/:chatId — send a message
router.post('/chat/:chatId', asyncHandler(async (req, res) => {
    const { content, message_type = 'text' } = req.body || {};
    if (!content?.trim()) {
        return res.status(400).json({ status: 'error', message: 'Content is required' });
    }
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    const userId = req.user.id;
    const chatId = req.params.chatId;

    const { data: chat } = await supabase
        .from('chats').select('id,farmer_id,owner_id').eq('id', chatId).maybeSingle();
    if (!chat || (chat.farmer_id !== userId && chat.owner_id !== userId)) {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const { data, error } = await supabase
        .from('messages')
        .insert({
            chat_id:      chatId,
            sender_id:    userId,
            content:      content.trim(),
            message_type: message_type === 'image' ? 'image' : 'text',
            is_read:      false,
        })
        .select('id, chat_id, sender_id, content, message_type, is_read, created_at')
        .single();

    if (error) throw error;

    /* Notify recipient */
    const recipientId = chat.farmer_id === userId ? chat.owner_id : chat.farmer_id;
    if (recipientId) {
        sendNotification(recipientId, {
            type: 'system',
            title: 'New Message',
            message: content.trim().slice(0, 80),
            data: { chatId },
        }).catch(() => {});
    }

    return res.status(201).json({ success: true, message: data });
}));

// PATCH /api/v1/messages/chat/:chatId/read — mark messages as read
router.patch('/chat/:chatId/read', asyncHandler(async (req, res) => {
    if (!supabase) return res.json({ success: true });

    const userId = req.user.id;
    const chatId = req.params.chatId;

    await supabase
        .from('messages')
        .update({ is_read: true })
        .eq('chat_id', chatId)
        .neq('sender_id', userId);

    return res.json({ success: true });
}));

module.exports = router;
