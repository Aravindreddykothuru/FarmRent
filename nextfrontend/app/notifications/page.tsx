'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Bell, ChevronLeft, CheckCheck, Trash2, Package,
    BookOpen, IndianRupee, Star, AlertCircle, Info, RefreshCw,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';

interface Notif {
    _id: string;
    type: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    data?: Record<string, string>;
}

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; deepLink?: (d?: Record<string, string>) => string }> = {
    booking_request:   { icon: <BookOpen className="h-4 w-4" />,      color: 'bg-blue-100 text-blue-600',   deepLink: d => d?.bookingId ? `/bookings/${d.bookingId}` : '/bookings' },
    booking_confirmed: { icon: <Package className="h-4 w-4" />,       color: 'bg-green-100 text-green-600', deepLink: d => d?.bookingId ? `/bookings/${d.bookingId}` : '/bookings' },
    booking_rejected:  { icon: <AlertCircle className="h-4 w-4" />,   color: 'bg-red-100 text-red-600',     deepLink: d => d?.bookingId ? `/bookings/${d.bookingId}` : '/bookings' },
    booking_cancelled: { icon: <AlertCircle className="h-4 w-4" />,   color: 'bg-orange-100 text-orange-600', deepLink: d => d?.bookingId ? `/bookings/${d.bookingId}` : '/bookings' },
    payment_success:   { icon: <IndianRupee className="h-4 w-4" />,   color: 'bg-emerald-100 text-emerald-600', deepLink: d => d?.bookingId ? `/bookings/${d.bookingId}` : '/wallet' },
    payment_failed:    { icon: <IndianRupee className="h-4 w-4" />,   color: 'bg-red-100 text-red-600',     deepLink: () => '/wallet' },
    review_received:   { icon: <Star className="h-4 w-4" />,          color: 'bg-yellow-100 text-yellow-600', deepLink: () => '/dashboard/owner' },
    system:            { icon: <Info className="h-4 w-4" />,          color: 'bg-gray-100 text-gray-600' },
};

function relTime(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)   return `${days}d ago`;
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
    const [notifs,   setNotifs]   = useState<Notif[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [filter,   setFilter]   = useState<'all' | 'unread'>('all');
    const [deleting, setDeleting] = useState<Set<string>>(new Set());

    const fetch = useCallback(() => {
        setLoading(true);
        nodeApi.get<{ notifications: Notif[]; unreadCount: number }>('/notifications?limit=50')
            .then(r => setNotifs(r?.notifications ?? []))
            .catch(() => toast.error('Could not load notifications'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

    const markRead = async (id: string) => {
        setNotifs(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
        nodeApi.patch(`/notifications/${id}/read`, {}).catch(() => {});
    };

    const markAllRead = async () => {
        setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
        nodeApi.patch('/notifications/read-all', {}).catch(() => {});
        toast.success('All notifications marked as read');
    };

    const remove = async (id: string) => {
        setDeleting(prev => new Set([...prev, id]));
        setNotifs(prev => prev.filter(n => n._id !== id));
        nodeApi.delete(`/notifications/${id}`).catch(() => {});
    };

    const displayed = filter === 'unread' ? notifs.filter(n => !n.isRead) : notifs;
    const unreadCt  = notifs.filter(n => !n.isRead).length;

    return (
        <div className="min-h-screen bg-[#F7F8FA]">

            {/* Header */}
            <div className="bg-white border-b sticky top-0 z-10">
                <div className="container mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/dashboard" className="p-2 rounded-xl hover:bg-gray-100 -ml-2">
                            <ChevronLeft className="h-5 w-5 text-gray-600" />
                        </Link>
                        <div>
                            <h1 className="font-black text-gray-900">Notifications</h1>
                            {unreadCt > 0 && (
                                <p className="text-xs text-gray-500">{unreadCt} unread</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={fetch} className="p-2 rounded-xl hover:bg-gray-100" aria-label="Refresh">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </button>
                        {unreadCt > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={markAllRead}
                                className="text-xs rounded-xl gap-1"
                            >
                                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="container mx-auto max-w-lg px-4 py-4 space-y-3">

                {/* Filter tabs */}
                <div className="flex gap-2 bg-white rounded-2xl p-1.5 border border-gray-100 shadow-sm">
                    {(['all', 'unread'] as const).map(f => (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${
                                filter === f ? 'bg-green-700 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {f === 'all' ? `All (${notifs.length})` : `Unread (${unreadCt})`}
                        </button>
                    ))}
                </div>

                {/* List */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="divide-y divide-gray-50">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="flex items-start gap-3 p-4">
                                    <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
                                    <div className="flex-1 space-y-1.5">
                                        <Skeleton className="h-3.5 w-3/4 rounded" />
                                        <Skeleton className="h-3 w-full rounded" />
                                        <Skeleton className="h-3 w-1/4 rounded" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : displayed.length === 0 ? (
                        <div className="py-20 text-center px-4">
                            <Bell className="h-12 w-12 text-gray-200 mx-auto mb-4" />
                            <p className="text-gray-600 font-bold text-base mb-1">
                                {filter === 'unread' ? 'All caught up!' : 'No notifications yet'}
                            </p>
                            <p className="text-gray-400 text-sm">
                                {filter === 'unread'
                                    ? 'You have no unread notifications'
                                    : 'Booking confirmations, payment alerts, and updates will appear here'}
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {displayed.map(n => {
                                const meta     = TYPE_META[n.type] ?? TYPE_META.system;
                                const deepLink = meta.deepLink?.(n.data);

                                return (
                                    <div
                                        key={n._id}
                                        className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${!n.isRead ? 'bg-green-50/40' : 'hover:bg-gray-50'}`}
                                    >
                                        {/* Icon */}
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.color}`}>
                                            {meta.icon}
                                        </div>

                                        {/* Content */}
                                        <div
                                            className="flex-1 min-w-0 cursor-pointer"
                                            onClick={() => !n.isRead && markRead(n._id)}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <p className={`text-sm leading-snug ${!n.isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                                                    {n.title}
                                                </p>
                                                {!n.isRead && (
                                                    <span className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full mt-1.5" />
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                                            <div className="flex items-center gap-3 mt-1.5">
                                                <span className="text-[10px] text-gray-400">{relTime(n.createdAt)}</span>
                                                {deepLink && (
                                                    <Link
                                                        href={deepLink}
                                                        className="text-[10px] text-green-700 font-semibold hover:underline"
                                                        onClick={() => !n.isRead && markRead(n._id)}
                                                    >
                                                        View details →
                                                    </Link>
                                                )}
                                            </div>
                                        </div>

                                        {/* Delete */}
                                        <button
                                            type="button"
                                            onClick={() => remove(n._id)}
                                            disabled={deleting.has(n._id)}
                                            className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
                                            aria-label="Delete notification"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer note */}
                {!loading && notifs.length > 0 && (
                    <p className="text-center text-xs text-gray-400 pb-4">
                        Notifications are kept for 30 days
                    </p>
                )}
            </div>
        </div>
    );
}
