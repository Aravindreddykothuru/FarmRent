/**
 * Messaging — /api/v1/messages (mounted behind auth(true))
 *
 * Two conversation types:
 *   - booking threads:  /:bookingId            (renter ↔ owner of a booking)
 *   - equipment chats:  /chats, /chat/:chatId  (a farmer asking an owner about a listing)
 * The literal /chats and /chat/... routes are registered first so they are not captured by /:bookingId.
 */
'use strict';

const express = require('express');
const router = express.Router();

const supabase = require('../lib/supabase');
const logger = require('../lib/logger');
const { HttpError } = require('../lib/httpError');
const { asyncHandler } = require('../middleware/asyncHandler');
const { validate } = require('../middleware/validate');
const { chatInitSchema } = require('../validations/schemas');
const { sendNotification } = require('../lib/notificationService');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 2000;
const INBOX_MESSAGE_SCAN_LIMIT = 1000;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

function notify(userId, payload) {
    if (!userId) return;
    sendNotification(userId, payload).catch((err) => logger.warn('[messages] notification enqueue failed', { userId, error: err.message }));
}

function messageContent(body) {
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) throw new HttpError(400, 'VALIDATION_ERROR', 'Message content is required');
    if (content.length > MAX_MESSAGE_LENGTH) {
        throw new HttpError(400, 'VALIDATION_ERROR', `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`);
    }
    return content;
}

function markRead(messageIds) {
    if (messageIds.length === 0) return;
    db()
        .from('messages')
        .update({ is_read: true })
        .in('id', messageIds)
        .then(
            ({ error }) => {
                if (error) logger.warn('[messages] mark-read failed', { error: error.message });
            },
            (err) => logger.warn('[messages] mark-read failed', { error: err.message }),
        );
}

async function bookingForParticipant(bookingId, userId) {
    if (!UUID_RE.test(bookingId)) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const { data, error } = await db()
        .from('equipment_rentals')
        .select('id, renter_id, owner_id, status')
        .eq('id', bookingId)
        .maybeSingle();
    if (error) throw error;
    if (!data || (data.renter_id !== userId && data.owner_id !== userId)) {
        throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    return data;
}

async function chatForParticipant(chatId, userId) {
    if (!UUID_RE.test(chatId)) throw new HttpError(404, 'CHAT_NOT_FOUND', 'Chat not found');
    const { data, error } = await db().from('chats').select('id, farmer_id, owner_id').eq('id', chatId).maybeSingle();
    if (error) throw error;
    if (!data || (data.farmer_id !== userId && data.owner_id !== userId)) {
        throw new HttpError(404, 'CHAT_NOT_FOUND', 'Chat not found');
    }
    return data;
}

/* ══════════════════════════════════════════════════════════════════════
   Equipment chats
   ══════════════════════════════════════════════════════════════════════ */

// GET /api/v1/messages/chats — inbox sorted by latest message
router.get(
    '/chats',
    asyncHandler(async (req, res) => {
        const userId = req.user.id;

        const { data: chatRows, error } = await db()
            .from('chats')
            .select(
                `
            id, equipment_id, farmer_id, owner_id, created_at,
            equipment:equipment_id ( name, images ),
            farmer:farmer_id ( full_name, avatar_url ),
            owner:owner_id ( full_name, avatar_url, phone )
        `,
            )
            .or(`farmer_id.eq.${userId},owner_id.eq.${userId}`)
            .order('created_at', { ascending: false });
        if (error) throw error;

        const chats = chatRows || [];
        // One query for all conversations instead of two per chat.
        const lastMessage = new Map();
        const unread = new Map();
        if (chats.length > 0) {
            const { data: messages, error: msgError } = await db()
                .from('messages')
                .select('chat_id, content, created_at, is_read, sender_id')
                .in(
                    'chat_id',
                    chats.map((c) => c.id),
                )
                .order('created_at', { ascending: false })
                .limit(INBOX_MESSAGE_SCAN_LIMIT);
            if (msgError) throw msgError;
            for (const m of messages || []) {
                if (!lastMessage.has(m.chat_id)) lastMessage.set(m.chat_id, m);
                if (!m.is_read && m.sender_id !== userId) unread.set(m.chat_id, (unread.get(m.chat_id) || 0) + 1);
            }
        }

        const inbox = chats.map((c) => {
            const isFarmer = c.farmer_id === userId;
            const other = isFarmer ? c.owner : c.farmer;
            const last = lastMessage.get(c.id);
            return {
                id: c.id,
                equipment_id: c.equipment_id,
                equipment_name: c.equipment?.name ?? 'Equipment',
                equipment_image: c.equipment?.images?.[0] ?? null,
                other_user_id: isFarmer ? c.owner_id : c.farmer_id,
                other_user_name: other?.full_name ?? 'User',
                other_user_phone: isFarmer ? (c.owner?.phone ?? null) : null,
                other_user_avatar: other?.avatar_url ?? null,
                last_message: last?.content ?? null,
                last_message_at: last?.created_at ?? null,
                unread_count: unread.get(c.id) ?? 0,
            };
        });
        inbox.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

        return res.json({ chats: inbox });
    }),
);

// POST /api/v1/messages/chat/init — get or create the chat between the caller and a listing's owner
router.post(
    '/chat/init',
    validate(chatInitSchema),
    asyncHandler(async (req, res) => {
        const farmerId = req.user.id;
        const { data: equipment, error: eqError } = await db()
            .from('equipment')
            .select('id, owner_id, is_deleted')
            .eq('id', req.body.equipment_id)
            .maybeSingle();
        if (eqError) throw eqError;
        if (!equipment || equipment.is_deleted) throw new HttpError(404, 'EQUIPMENT_NOT_FOUND', 'Equipment not found');
        if (equipment.owner_id === farmerId) throw new HttpError(400, 'OWN_EQUIPMENT', 'You cannot start a chat about your own listing');

        const { data: existing, error: findError } = await db()
            .from('chats')
            .select('id')
            .eq('equipment_id', equipment.id)
            .eq('farmer_id', farmerId)
            .maybeSingle();
        if (findError) throw findError;
        if (existing) return res.json({ chat_id: existing.id });

        const { data: created, error } = await db()
            .from('chats')
            .insert({ equipment_id: equipment.id, farmer_id: farmerId, owner_id: equipment.owner_id })
            .select('id')
            .single();
        if (error?.code === '23505') {
            // Created concurrently by another request from the same user.
            const { data: raced, error: raceError } = await db()
                .from('chats')
                .select('id')
                .eq('equipment_id', equipment.id)
                .eq('farmer_id', farmerId)
                .single();
            if (raceError) throw raceError;
            return res.json({ chat_id: raced.id });
        }
        if (error) throw error;
        return res.status(201).json({ chat_id: created.id });
    }),
);

// GET /api/v1/messages/chat/:chatId
router.get(
    '/chat/:chatId',
    asyncHandler(async (req, res) => {
        const chat = await chatForParticipant(req.params.chatId, req.user.id);
        const { data, error } = await db()
            .from('messages')
            .select('id, chat_id, sender_id, content, message_type, is_read, created_at')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: true });
        if (error) throw error;

        markRead((data || []).filter((m) => !m.is_read && m.sender_id !== req.user.id).map((m) => m.id));
        return res.json({ messages: data || [] });
    }),
);

// POST /api/v1/messages/chat/:chatId
router.post(
    '/chat/:chatId',
    asyncHandler(async (req, res) => {
        const chat = await chatForParticipant(req.params.chatId, req.user.id);
        const content = messageContent(req.body);

        const { data, error } = await db()
            .from('messages')
            .insert({
                chat_id: chat.id,
                sender_id: req.user.id,
                content,
                message_type: req.body?.message_type === 'image' ? 'image' : 'text',
                is_read: false,
            })
            .select('id, chat_id, sender_id, content, message_type, is_read, created_at')
            .single();
        if (error) throw error;

        const recipientId = chat.farmer_id === req.user.id ? chat.owner_id : chat.farmer_id;
        notify(recipientId, {
            type: 'system',
            title: 'New Message',
            message: content.slice(0, 80),
            data: { chatId: chat.id },
        });

        // Live delivery to the other participant's authenticated /notifications room (see tracking-service/socket.js).
        const { isSocketReady, getIo } = require('../services/tracking-service/socket');
        if (isSocketReady()) {
            getIo().of('/notifications').to(`user_${recipientId}`).emit('chat:message', { chat_id: chat.id, message: data });
        }
        return res.status(201).json({ success: true, message: data });
    }),
);

// PATCH /api/v1/messages/chat/:chatId/read
router.patch(
    '/chat/:chatId/read',
    asyncHandler(async (req, res) => {
        const chat = await chatForParticipant(req.params.chatId, req.user.id);
        const { error } = await db().from('messages').update({ is_read: true }).eq('chat_id', chat.id).neq('sender_id', req.user.id);
        if (error) throw error;
        return res.json({ success: true });
    }),
);

/* ══════════════════════════════════════════════════════════════════════
   Booking threads
   ══════════════════════════════════════════════════════════════════════ */

// GET /api/v1/messages/:bookingId
router.get(
    '/:bookingId',
    asyncHandler(async (req, res) => {
        const booking = await bookingForParticipant(req.params.bookingId, req.user.id);
        const { data, error } = await db()
            .from('messages')
            .select('id, sender_id, content, is_read, created_at, users(full_name)')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: true });
        if (error) throw error;

        const messages = (data || []).map((m) => ({
            id: m.id,
            sender_id: m.sender_id,
            sender_name: m.users?.full_name || 'Unknown',
            content: m.content,
            is_read: m.is_read,
            created_at: m.created_at,
            is_mine: m.sender_id === req.user.id,
        }));
        markRead((data || []).filter((m) => !m.is_read && m.sender_id !== req.user.id).map((m) => m.id));
        return res.json({ messages });
    }),
);

// POST /api/v1/messages/:bookingId
router.post(
    '/:bookingId',
    asyncHandler(async (req, res) => {
        const booking = await bookingForParticipant(req.params.bookingId, req.user.id);
        const content = messageContent(req.body);

        const { data, error } = await db()
            .from('messages')
            .insert({ booking_id: booking.id, sender_id: req.user.id, content, is_read: false })
            .select('id, sender_id, content, is_read, created_at')
            .single();
        if (error) throw error;

        notify(booking.renter_id === req.user.id ? booking.owner_id : booking.renter_id, {
            type: 'system',
            title: 'New Message',
            message: content.slice(0, 80),
            data: { bookingId: booking.id },
        });

        // Real-time delivery to the booking room (participants only — see tracking-service/socket.js)
        try {
            const { getIo } = require('../services/tracking-service/socket');
            getIo()
                .of('/tracking')
                .to(`booking_${booking.id}`)
                .emit('message:new', { ...data, is_mine: false });
        } catch (err) {
            logger.warn('[messages] realtime delivery skipped', { bookingId: booking.id, error: err.message });
        }

        return res.status(201).json({ success: true, message: { ...data, is_mine: true } });
    }),
);

// PATCH /api/v1/messages/:bookingId/read
router.patch(
    '/:bookingId/read',
    asyncHandler(async (req, res) => {
        const booking = await bookingForParticipant(req.params.bookingId, req.user.id);
        const { error } = await db().from('messages').update({ is_read: true }).eq('booking_id', booking.id).neq('sender_id', req.user.id);
        if (error) throw error;
        return res.json({ success: true });
    }),
);

module.exports = router;
