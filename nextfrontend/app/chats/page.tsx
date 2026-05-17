'use client';

/**
 * /chats — OLX-style inbox showing all conversations for the current user.
 * Sorted by latest message. Each row shows equipment image, equipment name,
 * last message preview, timestamp, and unread badge count.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/EmptyState';
import { MessageSquare, User, Search, Tractor } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const EquipmentChatDrawer = dynamic(() => import('@/components/EquipmentChatDrawer'), { ssr: false });

interface ChatRow {
    id: string;
    equipment_id: string;
    equipment_name: string;
    equipment_image?: string;
    other_user_id: string;
    other_user_name: string;
    other_user_phone?: string;
    other_user_avatar?: string;
    last_message?: string;
    last_message_at?: string;
    unread_count: number;
}

export default function ChatsPage() {
    const { user, isAuthenticated } = useAuth();
    const { t } = useLanguage();

    function formatRelative(ts: string) {
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return t('chats.justNow');
        if (diffMins < 60) return t('chats.minsAgo', { mins: String(diffMins) });
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return t('chats.hoursAgo', { hours: String(diffHours) });
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return t('chats.daysAgo', { days: String(diffDays) });
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    const router = useRouter();
    const [chats, setChats]       = useState<ChatRow[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState(false);
    const [search, setSearch]     = useState('');
    const [activeChat, setActiveChat] = useState<ChatRow | null>(null);

    const load = useCallback(async () => {
        if (!isAuthenticated) return;
        try {
            const res: any = await nodeApi.get('/messages/chats');
            setChats(res?.chats ?? res?.data ?? []);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated) { router.push('/login'); return; }
        load();
    }, [isAuthenticated, load, router]);

    /* ── Realtime unread badge updates ─────────────────────────────────── */
    useEffect(() => {
        if (!supabase || !user?.id) return;
        const sb = supabase;
        const channel = sb
            .channel(`inbox:${user.id}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                () => { load(); }
            )
            .subscribe();
        return () => { sb.removeChannel(channel); };
    }, [user?.id, load]);

    const filtered = chats.filter(c =>
        !search ||
        c.equipment_name.toLowerCase().includes(search.toLowerCase()) ||
        c.other_user_name.toLowerCase().includes(search.toLowerCase()) ||
        c.last_message?.toLowerCase().includes(search.toLowerCase())
    );

    const totalUnread = chats.reduce((sum, c) => sum + (c.unread_count || 0), 0);

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 py-5 max-w-3xl">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                                <MessageSquare className="h-6 w-6 text-green-700" />
                                {t('chats.title')}
                                {totalUnread > 0 && (
                                    <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 ml-1">
                                        {totalUnread}
                                    </span>
                                )}
                            </h1>
                            <p className="text-gray-500 text-sm mt-0.5">{t('chats.subtitle')}</p>
                        </div>
                    </div>
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder={t('chats.searchPlaceholder')}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-gray-50"
                        />
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 py-4 max-w-3xl">
                {loading && (
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="bg-white rounded-2xl p-4 flex gap-3 border border-gray-100">
                                <Skeleton className="w-14 h-14 rounded-xl flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <Skeleton className="h-4 w-2/3" />
                                    <Skeleton className="h-3 w-1/2" />
                                    <Skeleton className="h-3 w-3/4" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && error && (
                    <EmptyState
                        icon="💬"
                        title={t('chats.loadError')}
                        description={t('chats.loadErrorDesc')}
                        action={{ label: t('chats.retry'), onClick: load }}
                    />
                )}

                {!loading && !error && filtered.length === 0 && (
                    <EmptyState
                        icon="💬"
                        title={search ? t('chats.noMatch') : t('chats.noConversations')}
                        description={search ? t('chats.tryDifferent') : t('chats.startConversation')}
                        action={!search ? { label: t('chats.browseEquipment'), onClick: () => router.push('/browse') } : undefined}
                    />
                )}

                {!loading && !error && filtered.length > 0 && (
                    <div className="space-y-2">
                        {filtered.map(chat => (
                            <button
                                key={chat.id}
                                type="button"
                                onClick={() => setActiveChat(chat)}
                                className={`w-full bg-white rounded-2xl p-4 flex items-center gap-3 border text-left transition-all hover:border-green-200 hover:shadow-sm ${
                                    chat.unread_count > 0 ? 'border-green-200 bg-green-50/30' : 'border-gray-100'
                                }`}
                            >
                                {/* Equipment image / placeholder */}
                                <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                                    {chat.equipment_image
                                        ? <img src={chat.equipment_image} alt={chat.equipment_name} className="w-full h-full object-cover" />
                                        : <Tractor className="h-6 w-6 text-gray-300" />}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className={`text-sm font-bold truncate ${chat.unread_count > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
                                            {chat.equipment_name}
                                        </p>
                                        {chat.last_message_at && (
                                            <span className="text-[10px] text-gray-400 font-medium flex-shrink-0 mt-0.5">
                                                {formatRelative(chat.last_message_at)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                            {chat.other_user_avatar
                                                ? <img src={chat.other_user_avatar} alt="" className="w-full h-full object-cover" />
                                                : <User className="h-2.5 w-2.5 text-gray-400" />}
                                        </div>
                                        <span className="text-xs text-gray-500 font-medium truncate">{chat.other_user_name}</span>
                                    </div>
                                    {chat.last_message && (
                                        <p className={`text-xs mt-1 truncate ${chat.unread_count > 0 ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                                            {chat.last_message}
                                        </p>
                                    )}
                                </div>

                                {/* Unread badge */}
                                {chat.unread_count > 0 && (
                                    <span className="bg-green-700 text-white text-xs font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center flex-shrink-0">
                                        {chat.unread_count > 9 ? '9+' : chat.unread_count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Open drawer for selected chat */}
            {activeChat && (
                <EquipmentChatDrawer
                    equipmentId={activeChat.equipment_id}
                    equipmentName={activeChat.equipment_name}
                    equipmentImage={activeChat.equipment_image}
                    owner={{
                        id: activeChat.other_user_id,
                        name: activeChat.other_user_name,
                        phone: activeChat.other_user_phone,
                        avatar: activeChat.other_user_avatar,
                    }}
                    onClose={() => { setActiveChat(null); load(); }}
                />
            )}
        </div>
    );
}
