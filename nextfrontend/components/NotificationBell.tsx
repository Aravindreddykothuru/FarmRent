'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { connectNotifSocket } from '@/lib/socket';
import { useLanguage } from '@/context/LanguageContext';

interface Notif {
    _id: string; type: string; title: string; message: string;
    isRead: boolean; createdAt: string; data?: Record<string, string>;
}

const TYPE_ICONS: Record<string, string> = {
    booking_request:   '📋',
    booking_confirmed: '✅',
    booking_rejected:  '❌',
    booking_cancelled: '🚫',
    payment_success:   '💰',
    review_received:   '⭐',
    system:            '🔔',
};

export default function NotificationBell() {
    const { t } = useLanguage();
    const [open, setOpen]             = useState(false);
    const [notifs, setNotifs]         = useState<Notif[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading]       = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const fetchNotifs = useCallback(async () => {
        setLoading(true);
        try {
            const r = await nodeApi.get<{ notifications: Notif[]; unreadCount: number }>('/notifications?limit=20');
            setNotifs(r?.notifications ?? []);
            setUnreadCount(r?.unreadCount ?? 0);
        } catch { /* unauthenticated or network error — silent */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        fetchNotifs();

        // Real-time via /notifications namespace (where backend emits notification:new)
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (!token) return;
        const socket = connectNotifSocket(token);

        const handler = (n: Notif) => {
            setNotifs(prev => [n, ...prev].slice(0, 20));
            setUnreadCount(c => c + 1);
        };
        socket.on('notification:new', handler);
        return () => { socket.off('notification:new', handler); };
    }, [fetchNotifs]);

    // Close panel when clicking outside
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const markRead = async (id: string) => {
        try {
            await nodeApi.patch(`/notifications/${id}/read`, {});
            setNotifs(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
            setUnreadCount(c => Math.max(0, c - 1));
        } catch { /**/ }
    };

    const markAllRead = async () => {
        try {
            await nodeApi.patch('/notifications/read-all', {});
            setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
            setUnreadCount(0);
        } catch { /**/ }
    };

    const deleteNotif = async (id: string) => {
        const target = notifs.find(n => n._id === id);
        setNotifs(prev => prev.filter(n => n._id !== id));
        if (target && !target.isRead) setUnreadCount(c => Math.max(0, c - 1));
        try { await nodeApi.delete(`/notifications/${id}`); } catch { /**/ }
    };

    return (
        <div className="relative" ref={panelRef}>
            {/* Bell Button */}
            <button
                type="button"
                onClick={() => { setOpen(o => !o); if (!open) fetchNotifs(); }}
                className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
                aria-label="Notifications"
            >
                <Bell className="h-5 w-5 text-gray-600" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center leading-none">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown Panel */}
            {open && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl z-50 overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b">
                        <h3 className="font-semibold text-sm">{t('common.notifications')}</h3>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button type="button" onClick={markAllRead} className="text-xs text-green-700 hover:underline flex items-center gap-0.5">
                                    <CheckCheck className="h-3 w-3" /> {t('common.markAllRead')}
                                </button>
                            )}
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">
                                <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                            </button>
                        </div>
                    </div>

                    {/* List */}
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                        {loading ? (
                            <div className="py-8 flex justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-700" />
                            </div>
                        ) : notifs.length === 0 ? (
                            <div className="py-10 text-center text-gray-400">
                                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">{t('common.noNotifications')}</p>
                            </div>
                        ) : (
                            notifs.map(n => (
                                <div key={n._id} className={`flex items-start gap-1 ${!n.isRead ? 'bg-green-50/50' : ''}`}>
                                    {/* Notification content — clickable to mark read */}
                                    <button
                                        type="button"
                                        className="flex flex-1 gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors w-full"
                                        onClick={() => !n.isRead && markRead(n._id)}
                                        aria-label={n.isRead ? n.title : `Mark as read: ${n.title}`}
                                    >
                                        <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">{TYPE_ICONS[n.type] ?? '🔔'}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                                                {n.title}
                                            </p>
                                            <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{n.message}</p>
                                            <p className="text-xs text-gray-400 mt-1">
                                                {new Date(n.createdAt).toLocaleString('en-IN', {
                                                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                                                })}
                                            </p>
                                        </div>
                                    </button>
                                    {/* Delete button — sibling, not nested */}
                                    <button
                                        type="button"
                                        onClick={() => deleteNotif(n._id)}
                                        className="flex-shrink-0 mt-3 mr-3 p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                                        aria-label="Delete notification"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
