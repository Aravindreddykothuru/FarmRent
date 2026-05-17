'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { nodeApi } from '@/lib/api';
import { connectTrackingSocket } from '@/lib/socket';
import { Send, MessageSquare, AlertCircle } from 'lucide-react';

interface Message {
    id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    is_read: boolean;
    created_at: string;
    is_mine: boolean;
}

interface Props {
    bookingId: string;
}

export default function BookingChat({ bookingId }: Props) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput]       = useState('');
    const [sending, setSending]   = useState(false);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        nodeApi.get<{ messages: Message[] }>(`/messages/${bookingId}`)
            .then(r => { setMessages(r.messages || []); })
            .catch(() => { setError('Could not load messages. Please try again.'); })
            .finally(() => setLoading(false));
    }, [bookingId]);

    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

    // Real-time via /tracking namespace (where backend emits message:new)
    useEffect(() => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (!token) return;
        const socket = connectTrackingSocket(token);
        socket.emit('join_booking_room', bookingId);

        const handler = (msg: Message) => {
            setMessages(prev => {
                if (prev.some(m => m.id === msg.id)) return prev;
                return [...prev, { ...msg, is_mine: false }];
            });
        };
        socket.on('message:new', handler);
        return () => { socket.off('message:new', handler); };
    }, [bookingId]);

    const handleSend = async () => {
        if (!input.trim() || sending) return;
        setSending(true);
        const text = input.trim();
        setInput('');
        try {
            const r = await nodeApi.post<{ success: boolean; message: Message }>(`/messages/${bookingId}`, { content: text });
            setMessages(prev => [...prev, r.message]);
        } catch {
            setInput(text);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50">
                <MessageSquare className="h-4 w-4 text-green-700" />
                <span className="font-semibold text-sm text-gray-800">Messages</span>
            </div>

            <div className="h-64 overflow-y-auto p-4 space-y-3">
                {loading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-700" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                        <AlertCircle className="h-8 w-8 text-red-300" />
                        <p className="text-sm text-red-500">{error}</p>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                        <p className="text-sm">No messages yet. Start the conversation.</p>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.is_mine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${msg.is_mine ? 'bg-green-700 text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'}`}>
                                {!msg.is_mine && (
                                    <p className="text-xs font-medium mb-0.5 opacity-70">{msg.sender_name}</p>
                                )}
                                <p className="text-sm">{msg.content}</p>
                                <p className={`text-xs mt-0.5 ${msg.is_mine ? 'text-green-200' : 'text-gray-400'}`}>
                                    {new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>

            <div className="px-4 py-3 border-t flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Type a message…"
                    className="flex-1 border border-gray-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    disabled={sending || !!error}
                />
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !input.trim() || !!error}
                    className="bg-green-700 text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-green-800 disabled:opacity-40 transition-colors"
                    aria-label="Send message"
                >
                    <Send className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
