'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Calendar, IndianRupee, Package, ChevronRight,
    Navigation, RotateCcw, XCircle, Clock,
    CheckCircle2, AlertCircle,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';

interface Booking {
    id?: string;
    _id?: string;
    equipment?: { name: string; images?: string[]; type?: string };
    equipment_id?: string;
    start_date: string;
    end_date: string;
    status: string;
    total_amount?: number;
    payment_status?: string;
}

type Tab = 'active' | 'upcoming' | 'past' | 'cancelled';

const TAB_STATUSES: Record<Tab, string[]> = {
    active:    ['in_progress', 'requested'],
    upcoming:  ['pending', 'confirmed', 'accepted'],
    past:      ['completed'],
    cancelled: ['cancelled'],
};

const STATUS_STYLE: Record<string, { dot: string; badge: string; label: string }> = {
    requested:   { dot: 'bg-blue-400',   badge: 'bg-blue-50 text-blue-700',   label: 'Requested' },
    pending:     { dot: 'bg-amber-400',  badge: 'bg-amber-50 text-amber-700', label: 'Pending Approval' },
    accepted:    { dot: 'bg-indigo-400', badge: 'bg-indigo-50 text-indigo-700', label: 'Accepted' },
    confirmed:   { dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700', label: 'Confirmed' },
    in_progress: { dot: 'bg-blue-500',   badge: 'bg-blue-50 text-blue-700',   label: 'In Progress' },
    completed:   { dot: 'bg-gray-400',   badge: 'bg-gray-50 text-gray-600',   label: 'Completed' },
    cancelled:   { dot: 'bg-red-400',    badge: 'bg-red-50 text-red-600',     label: 'Cancelled' },
};

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200&q=60';

function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function BookingCard({ booking, onCancel, onRepeat }: {
    booking: Booking;
    onCancel: (b: Booking) => void;
    onRepeat: (b: Booking) => void;
}) {
    const bid    = booking.id ?? booking._id ?? '';
    const name   = booking.equipment?.name ?? 'Equipment';
    const img    = booking.equipment?.images?.[0] ?? FALLBACK;
    const cfg    = STATUS_STYLE[booking.status] ?? STATUS_STYLE.pending;
    const isActive    = ['in_progress', 'requested'].includes(booking.status);
    const isUpcoming  = ['pending', 'confirmed', 'accepted'].includes(booking.status);
    const isCompleted = booking.status === 'completed';
    const isCancelled = booking.status === 'cancelled';

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="flex">
                {/* Image */}
                <div className="w-24 flex-shrink-0 bg-gray-100 relative">
                    <img
                        src={img}
                        alt={name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }}
                    />
                    {booking.payment_status === 'paid' && (
                        <div className="absolute bottom-1 left-1 bg-green-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                            PAID
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-1">{name}</h3>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${cfg.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                        </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-2.5">
                        <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-green-600" />
                            {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                        </span>
                        <span className="flex items-center gap-1 font-bold text-gray-700">
                            <IndianRupee className="h-3 w-3" />
                            {Number(booking.total_amount ?? 0).toLocaleString('en-IN')}
                        </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        {isActive && (
                            <Link href={`/tracking/${bid}`}>
                                <Button size="sm" className="h-7 text-xs bg-indigo-700 hover:bg-indigo-800 rounded-xl px-3 gap-1">
                                    <Navigation className="h-3 w-3" /> Track
                                </Button>
                            </Link>
                        )}
                        {isUpcoming && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-200 text-red-500 hover:bg-red-50 rounded-xl px-3 gap-1"
                                onClick={() => onCancel(booking)}
                            >
                                <XCircle className="h-3 w-3" /> Cancel
                            </Button>
                        )}
                        {isCompleted && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-green-200 text-green-700 hover:bg-green-50 rounded-xl px-3 gap-1"
                                onClick={() => onRepeat(booking)}
                            >
                                <RotateCcw className="h-3 w-3" /> Book Again
                            </Button>
                        )}
                        <Link href={`/bookings/${bid}`} className="ml-auto">
                            <Button size="sm" variant="ghost" className="h-7 text-xs rounded-xl gap-1 text-gray-500">
                                Details <ChevronRight className="h-3 w-3" />
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function BookingsPage() {
    const router     = useRouter();
    const { t }      = useLanguage();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [tab,      setTab]      = useState<Tab>('active');

    const load = useCallback(() => {
        setLoading(true);
        nodeApi.get<{ success?: boolean; bookings?: Booking[] }>('/bookings/my')
            .then(r => setBookings(r?.bookings ?? []))
            .catch(() => toast.error(t('booking.loadError')))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleCancel = async (booking: Booking) => {
        const id = booking.id ?? booking._id;
        if (!id) return;
        try {
            await nodeApi.patch(`/bookings/${id}/cancel`, {});
            toast.success(t('booking.cancelSuccess'));
            load();
        } catch (e: any) { toast.error(e.message ?? 'Failed to cancel'); }
    };

    const handleRepeat = (booking: Booking) => {
        const mid = booking.equipment_id;
        if (mid) router.push(`/book/${mid}`);
        else toast.error('Equipment not available for re-booking');
    };

    const TAB_ICONS: Record<Tab, React.ReactNode> = {
        active:    <Navigation className="h-3.5 w-3.5" />,
        upcoming:  <Clock className="h-3.5 w-3.5" />,
        past:      <CheckCircle2 className="h-3.5 w-3.5" />,
        cancelled: <XCircle className="h-3.5 w-3.5" />,
    };

    const tabCounts = Object.fromEntries(
        (Object.keys(TAB_STATUSES) as Tab[]).map(t => [
            t,
            bookings.filter(b => TAB_STATUSES[t].includes(b.status)).length,
        ])
    ) as Record<Tab, number>;

    const filtered = bookings.filter(b => TAB_STATUSES[tab].includes(b.status));

    return (
        <div className="min-h-screen bg-[#F7F8FA]">

            {/* Header */}
            <div className="bg-white border-b sticky top-0 z-10">
                <div className="container mx-auto max-w-2xl px-4 pt-4 pb-0">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h1 className="text-xl font-black text-gray-900">{t('booking.myBookings')}</h1>
                            <p className="text-xs text-gray-500">{bookings.length} total bookings</p>
                        </div>
                        <Link href="/browse">
                            <Button size="sm" className="bg-green-700 hover:bg-green-800 rounded-xl text-xs gap-1">
                                <Package className="h-3.5 w-3.5" /> Browse Equipment
                            </Button>
                        </Link>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-0 border-b border-gray-100 -mx-4 px-4">
                        {(Object.keys(TAB_STATUSES) as Tab[]).map(t => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setTab(t)}
                                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize whitespace-nowrap ${
                                    tab === t
                                        ? 'border-green-700 text-green-700'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {TAB_ICONS[t]}
                                {t}
                                {tabCounts[t] > 0 && (
                                    <span className={`text-[10px] font-black rounded-full px-1.5 ${
                                        tab === t ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-600'
                                    }`}>{tabCounts[t]}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="container mx-auto max-w-2xl px-4 py-4 space-y-3">
                {loading ? (
                    [...Array(3)].map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
                            <Skeleton className="w-24 h-28 rounded-none" />
                            <div className="flex-1 p-4 space-y-2">
                                <Skeleton className="h-4 w-3/4 rounded" />
                                <Skeleton className="h-3 w-1/2 rounded" />
                                <Skeleton className="h-7 w-24 rounded-xl mt-2" />
                            </div>
                        </div>
                    ))
                ) : filtered.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
                        <AlertCircle className="h-10 w-10 text-gray-200 mx-auto mb-3" />
                        <p className="font-bold text-gray-700 mb-1">
                            {tab === 'active'    ? 'No active bookings'    :
                             tab === 'upcoming'  ? 'No upcoming bookings'  :
                             tab === 'past'      ? 'No completed bookings' :
                                                  'No cancelled bookings'}
                        </p>
                        <p className="text-gray-400 text-sm mb-5">
                            {tab === 'past' || tab === 'cancelled'
                                ? 'Your booking history will appear here'
                                : 'Book equipment to see your rentals here'}
                        </p>
                        {tab !== 'past' && tab !== 'cancelled' && (
                            <Link href="/browse">
                                <Button size="sm" className="bg-green-700 hover:bg-green-800 rounded-xl">Browse Equipment</Button>
                            </Link>
                        )}
                    </div>
                ) : (
                    filtered.map(b => (
                        <BookingCard
                            key={b.id ?? b._id}
                            booking={b}
                            onCancel={handleCancel}
                            onRepeat={handleRepeat}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
