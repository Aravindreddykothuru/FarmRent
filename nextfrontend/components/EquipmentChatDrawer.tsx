'use client';

/**
 * EquipmentChatDrawer — OLX-style real-time chat panel.
 * Opens as a right-side drawer from the equipment detail page.
 * Uses Supabase Realtime for instant message delivery.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import {
    X, Send, Phone, User, CheckCheck, Check,
    MessageSquare, Image as ImageIcon, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Owner {
    id?: string;
    name?: string;
    phone?: string;
    avatar?: string;
    memberSince?: string;
    totalRentals?: number;
}

interface Message {
    id: string;
    chat_id: string;
    sender_id: string;
    content: string;
    message_type: 'text' | 'image';
    is_read: boolean;
    created_at: string;
}

interface Props {
    equipmentId: string;
    equipmentName: string;
    equipmentImage?: string;
    owner: Owner;
    onClose: () => void;
}

function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function EquipmentChatDrawer({ equipmentId, equipmentName, equipmentImage, owner, onClose }: Props) {
    const { user, token } = useAuth();
    const { t } = useLanguage();
    const [chatId, setChatId]       = useState<string | null>(null);
    const [messages, setMessages]   = useState<Message[]>([]);
    const [input, setInput]         = useState('');
    const [sending, setSending]     = useState(false);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);

    const scrollToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    /* ── Initialise or fetch existing chat ─────────────────────────────── */
    useEffect(() => {
        if (!user || !token) return;
        let cancelled = false;

        (async () => {
            try {
                const res: any = await nodeApi.post('/messages/chat/init', {
                    equipment_id: equipmentId,
                    owner_id:     owner.id,
                });
                if (cancelled) return;
                const id = res?.chat_id ?? res?.data?.chat_id;
                if (!id) throw new Error('No chat_id returned');
                setChatId(id);

                const hist: any = await nodeApi.get(`/messages/chat/${id}`);
                if (!cancelled) setMessages(hist?.messages ?? []);
            } catch {
                if (!cancelled) setError(t('chat.openError'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [equipmentId, owner.id, token, user]);

    /* ── Supabase Realtime subscription ─────────────────────────────��─── */
    useEffect(() => {
        if (!chatId || !supabase) return;
        const sb = supabase;

        /* Mark messages as read */
        nodeApi.patch(`/messages/chat/${chatId}/read`, {}).catch(() => {});

        const channel = sb
            .channel(`chat:${chatId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
                (payload) => {
                    const msg = payload.new as Message;
                    setMessages(prev => {
                        if (prev.some(m => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                    if (msg.sender_id !== user?.id) {
                        nodeApi.patch(`/messages/chat/${chatId}/read`, {}).catch(() => {});
                    }
                }
            )
            .subscribe();

        channelRef.current = channel;
        return () => { sb.removeChannel(channel); };
    }, [chatId, user?.id]);

    /* ── Scroll on new message ─────────────────────────────────────────── */
    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

    const handleSend = async () => {
        if (!input.trim() || sending || !chatId) return;
        const text = input.trim();
        setInput('');
        setSending(true);

        /* Optimistic message */
        const optimistic: Message = {
            id: `opt-${Date.now()}`,
            chat_id: chatId,
            sender_id: user?.id ?? '',
            content: text,
            message_type: 'text',
            is_read: false,
            created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, optimistic]);

        try {
            await nodeApi.post(`/messages/chat/${chatId}`, { content: text, message_type: 'text' });
        } catch {
            setMessages(prev => prev.filter(m => m.id !== optimistic.id));
            setInput(text);
        } finally {
            setSending(false);
        }
    };

    const isMine = (msg: Message) => msg.sender_id === user?.id;

    return (
        /* Drawer backdrop */
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Chat with owner">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer panel */}
            <div className="relative w-full max-w-sm bg-white flex flex-col shadow-2xl h-full">

                {/* ── Header ── */}
                <div className="flex items-center gap-3 px-4 py-3 border-b bg-white shadow-sm flex-shrink-0">
                    {/* Owner avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-100 to-emerald-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {owner.avatar
                            ? <img src={owner.avatar} alt={owner.name} className="w-full h-full object-cover" />
                            : <User className="h-5 w-5 text-green-700" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-900 text-sm truncate">{owner.name || t('chat.equipmentOwner')}</p>
                        {owner.phone && (
                            <a href={`tel:${owner.phone}`} className="text-xs text-green-700 font-semibold flex items-center gap-1 hover:underline">
                                <Phone className="h-3 w-3" />{owner.phone}
                            </a>
                        )}
                    </div>
                    <button type="button" aria-label="Close chat" onClick={onClose}
                        className="p-2 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0">
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Equipment context bar */}
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b flex-shrink-0">
                    {equipmentImage && (
                        <img src={equipmentImage} alt={equipmentName} className="w-9 h-9 rounded-lg object-cover flex-shrink-0" />
                    )}
                    <p className="text-xs text-gray-600 font-medium truncate">Re: <span className="text-gray-900 font-bold">{equipmentName}</span></p>
                </div>

                {/* ── Messages ── */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                    {loading && (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-green-700" />
                        </div>
                    )}
                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <MessageSquare className="h-10 w-10 text-gray-200 mb-3" />
                            <p className="text-sm text-red-500 font-medium">{error}</p>
                        </div>
                    )}
                    {!loading && !error && messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                            <MessageSquare className="h-10 w-10 text-gray-200 mb-3" />
                            <p className="text-sm text-gray-500 font-medium">{t('chat.noMessages')}</p>
                            <p className="text-xs text-gray-400 mt-1">{t('chat.sayHello')}</p>
                        </div>
                    )}
                    {!loading && messages.map((msg) => (
                        <div key={msg.id} className={cn('flex', isMine(msg) ? 'justify-end' : 'justify-start')}>
                            <div className={cn(
                                'max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm',
                                isMine(msg)
                                    ? 'bg-green-700 text-white rounded-br-sm'
                                    : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                            )}>
                                <p className="text-sm leading-relaxed break-words">{msg.content}</p>
                                <div className={cn(
                                    'flex items-center gap-1 mt-0.5',
                                    isMine(msg) ? 'justify-end' : 'justify-start'
                                )}>
                                    <span className={cn('text-[10px]', isMine(msg) ? 'text-green-200' : 'text-gray-400')}>
                                        {formatTime(msg.created_at)}
                                    </span>
                                    {isMine(msg) && (
                                        msg.is_read
                                            ? <CheckCheck className="h-3 w-3 text-green-200" />
                                            : <Check className="h-3 w-3 text-green-300" />
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>

                {/* ── Input bar ── */}
                <div className="px-3 py-3 border-t bg-white flex items-end gap-2 flex-shrink-0">
                    <button type="button" aria-label="Attach image" className="p-2 rounded-full text-gray-400 hover:text-green-700 hover:bg-green-50 transition-colors flex-shrink-0">
                        <ImageIcon className="h-5 w-5" />
                    </button>
                    <div className="flex-1 relative">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                            }}
                            placeholder={t('chat.inputPlaceholder')}
                            rows={1}
                            disabled={sending || loading || !!error}
                            className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50 max-h-32 overflow-y-auto disabled:opacity-50"
                            style={{ minHeight: '42px' }}
                        />
                    </div>
                    <Button
                        type="button"
                        onClick={handleSend}
                        disabled={sending || !input.trim() || loading || !!error}
                        className="rounded-full w-10 h-10 p-0 bg-green-700 hover:bg-green-800 flex-shrink-0 disabled:opacity-40"
                        aria-label="Send message"
                    >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                </div>
            </div>
        </div>
    );
}
