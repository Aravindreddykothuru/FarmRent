'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BookingStatusBar from '@/components/BookingStatusBar';
import { useBookingSocket } from '@/hooks/useBookingSocket';
import {
    Calendar, Clock, CheckCircle2, IndianRupee, Navigation, Truck,
    Search, Heart, Tag, Star, MapPin, ChevronRight, Package,
    TrendingUp, Zap,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import WeatherWidget from '@/components/WeatherWidget';

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200&q=60';

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
    requested:   { dot: 'bg-blue-400',   text: 'text-blue-700 bg-blue-50' },
    pending:     { dot: 'bg-amber-400',  text: 'text-amber-700 bg-amber-50' },
    accepted:    { dot: 'bg-indigo-400', text: 'text-indigo-700 bg-indigo-50' },
    in_progress: { dot: 'bg-green-500',  text: 'text-green-700 bg-green-50' },
    completed:   { dot: 'bg-gray-400',   text: 'text-gray-600 bg-gray-100' },
    cancelled:   { dot: 'bg-red-400',    text: 'text-red-600 bg-red-50' },
};

interface Booking {
    id?: string; _id?: string;
    status: string;
    start_date?: string; startDate?: string;
    end_date?: string;   endDate?: string;
    total_amount?: number; totalAmount?: number;
    eta_minutes?: number; distance_km?: number;
    equipment?: { name?: string; type?: string; images?: string[]; location?: { district?: string } };
    machine?:   { _id?: string; name?: string; type?: string; images?: string[] };
    drivers?: { vehicle_name?: string; users?: { name?: string } };
}

function LiveStatusBadge({ bookingId, initialStatus }: { bookingId: string; initialStatus: string }) {
    const { status: live } = useBookingSocket(bookingId);
    const { t } = useLanguage();
    const s   = live?.status || initialStatus;
    const cfg = STATUS_STYLES[s] ?? STATUS_STYLES.pending;
    const STATUS_LABELS: Record<string, string> = {
        requested:   t('dashboard.statusRequested'),
        pending:     t('dashboard.statusPending'),
        accepted:    t('dashboard.statusAccepted'),
        in_progress: t('dashboard.statusInProgress'),
        completed:   t('dashboard.statusCompleted'),
        cancelled:   t('dashboard.statusCancelled'),
    };
    return (
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full', cfg.text)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
            {STATUS_LABELS[s] ?? s}
        </span>
    );
}

function safeDate(s?: string) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
}

function BookingCard({ b }: { b: Booking }) {
    const { t } = useLanguage();
    const id      = b.id ?? b._id ?? '';
    const name    = b.equipment?.name ?? b.machine?.name ?? 'Equipment';
    const image   = (b.equipment?.images ?? b.machine?.images ?? [])[0] ?? FALLBACK;
    const start   = b.start_date ?? b.startDate ?? '';
    const end     = b.end_date ?? b.endDate ?? '';
    const amt     = b.total_amount ?? b.totalAmount ?? 0;
    const isTrackable = ['requested','accepted','in_progress'].includes(b.status);
    const loc = b.equipment?.location?.district;

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
            <div className="flex gap-0">
                {/* Image strip */}
                <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
                    <img src={image} alt={name} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                </div>

                <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                            <h3 className="font-bold text-gray-900 text-sm leading-tight line-clamp-1">{name}</h3>
                            {loc && (
                                <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                                    <MapPin className="h-3 w-3 text-green-600" /> {loc}
                                </div>
                            )}
                        </div>
                        <LiveStatusBadge bookingId={id} initialStatus={b.status} />
                    </div>

                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                        <Calendar className="h-3 w-3 text-green-600" />
                        {safeDate(start)} → {safeDate(end)}
                    </div>

                    {b.drivers?.users?.name && (
                        <div className="flex items-center gap-1 text-xs text-indigo-600 mb-2">
                            <Truck className="h-3 w-3" />
                            {b.drivers.users.name}{b.drivers.vehicle_name && ` · ${b.drivers.vehicle_name}`}
                        </div>
                    )}

                    {b.eta_minutes && b.eta_minutes > 0 && (
                        <div className="flex items-center gap-1 text-xs text-amber-600 mb-2 font-semibold">
                            <Zap className="h-3 w-3" /> {t('dashboard.etaMinutes', { minutes: String(b.eta_minutes) })}
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-0.5 font-extrabold text-green-700">
                            <IndianRupee className="h-3 w-3" />
                            <span className="text-sm">{amt.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex gap-1.5">
                            {isTrackable && (
                                <Link href={`/tracking/${id}`}>
                                    <Button size="sm" className="h-7 text-[11px] bg-green-700 hover:bg-green-800 gap-1 px-3">
                                        <Navigation className="h-3 w-3" /> {t('dashboard.trackDelivery')}
                                    </Button>
                                </Link>
                            )}
                            <Link href={`/bookings/${id}`}>
                                <Button size="sm" variant="outline" className="h-7 text-[11px] px-3">{t('dashboard.viewDetails')}</Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Status progress bar */}
            {isTrackable && (
                <div className="px-4 pb-3 pt-1 border-t border-gray-50">
                    <BookingStatusBar status={b.status} />
                </div>
            )}
        </div>
    );
}

function SkeletonCard() {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden flex">
            <Skeleton className="w-24 h-28 flex-shrink-0" />
            <div className="flex-1 p-4 space-y-2.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-7 w-28 mt-1" />
            </div>
        </div>
    );
}

export default function FarmerDashboard() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading]   = useState(true);
    const [totalSpent, setTotalSpent] = useState(0);
    const [farmCoins, setFarmCoins]   = useState(0);

    useEffect(() => {
        nodeApi.get<any>('/bookings/my')
            .then(r => {
                const list: Booking[] = r?.bookings ?? r?.data ?? r ?? [];
                setBookings(list);
                const spent = list.reduce((sum, b) => sum + (b.total_amount ?? b.totalAmount ?? 0), 0);
                setTotalSpent(spent);
                setFarmCoins(Math.floor(spent / 100));
            })
            .catch(() => toast.error(t('booking.loadError')))
            .finally(() => setLoading(false));
    }, []);

    const getId  = (b: Booking) => b.id ?? b._id ?? '';
    const active  = bookings.filter(b => ['requested','pending','accepted','in_progress'].includes(b.status));
    const history = bookings.filter(b => ['completed','cancelled'].includes(b.status));
    const completed = history.filter(b => b.status === 'completed');

    const quickActions = [
        { href: '/browse',   icon: Search,  label: t('nav.browse'),   color: 'bg-green-50 text-green-700 hover:bg-green-100' },
        { href: '/wishlist', icon: Heart,   label: t('nav.wishlist'), color: 'bg-red-50 text-red-600 hover:bg-red-100' },
        { href: '/offers',   icon: Tag,     label: t('nav.offers'),   color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
        { href: '/reviews',  icon: Star,    label: t('dashboard.reviews'), color: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
    ];

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Hero header */}
            <div className="bg-gradient-to-br from-green-700 to-green-900 text-white px-4 lg:px-8 py-8">
                <div className="container mx-auto max-w-screen-xl">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-green-200 text-sm font-medium mb-1">{t('dashboard.welcome', { name: '' }).replace(', !', '!')}</p>
                            <h1 className="text-2xl lg:text-3xl font-black">
                                {user?.name || 'Farmer'} 👋
                            </h1>
                            <p className="text-green-200 text-sm mt-1">{t('dashboard.myBookings')}</p>
                            {farmCoins > 0 && (
                                <Link href="/wallet">
                                    <span className="inline-flex items-center gap-1.5 mt-2 bg-yellow-400/20 border border-yellow-400/30 text-yellow-200 text-xs font-bold px-3 py-1 rounded-full hover:bg-yellow-400/30 transition-colors">
                                        🪙 {farmCoins} FarmCoins
                                    </span>
                                </Link>
                            )}
                        </div>
                        <Link href="/browse">
                            <Button className="bg-white text-green-700 hover:bg-green-50 font-bold rounded-xl shadow-md">
                                <Search className="h-4 w-4 mr-1.5" /> {t('nav.browse')}
                            </Button>
                        </Link>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                        {[
                            { label: t('dashboard.totalBookings'), value: bookings.length,                            icon: Package     },
                            { label: t('dashboard.activeTab'),     value: active.length,                             icon: Clock       },
                            { label: t('dashboard.completedTab'),  value: completed.length,                          icon: CheckCircle2},
                            { label: t('booking.myBookings'),      value: `₹${(totalSpent/1000).toFixed(1)}k`,      icon: TrendingUp  },
                        ].map(s => (
                            <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                                <div className="flex items-center justify-between mb-2">
                                    <s.icon className="h-5 w-5 text-green-200" />
                                </div>
                                <div className="text-2xl font-black text-white">{s.value}</div>
                                <div className="text-xs text-green-200 mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 max-w-screen-xl py-6 space-y-6">
                {/* Quick Actions */}
                <div className="grid grid-cols-4 gap-3">
                    {quickActions.map(a => (
                        <Link key={a.href} href={a.href}>
                            <div className={cn('flex flex-col items-center gap-2 py-4 rounded-2xl text-sm font-semibold transition-colors cursor-pointer', a.color)}>
                                <a.icon className="h-6 w-6" />
                                <span className="text-xs">{a.label}</span>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Weather Widget */}
                <WeatherWidget />

                {/* Bookings tabs */}
                <Tabs defaultValue="active">
                    <TabsList className="bg-white rounded-xl border border-gray-100 shadow-sm p-1 h-auto">
                        <TabsTrigger value="active" className="rounded-lg text-sm font-semibold data-[state=active]:bg-green-700 data-[state=active]:text-white">
                            {t('dashboard.activeTab')}
                            {active.length > 0 && (
                                <span className="ml-1.5 bg-green-600 text-white text-[10px] font-bold rounded-full px-1.5 py-px data-[state=active]:bg-white data-[state=active]:text-green-700">
                                    {active.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="history" className="rounded-lg text-sm font-semibold data-[state=active]:bg-green-700 data-[state=active]:text-white">
                            {t('dashboard.completedTab')} ({history.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="active" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}</div>
                        ) : active.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-center">
                                <div className="bg-green-50 rounded-full h-16 w-16 flex items-center justify-center mb-4">
                                    <Calendar className="h-8 w-8 text-green-300" />
                                </div>
                                <h3 className="font-bold text-gray-700 mb-1">{t('dashboard.noBookings')}</h3>
                                <p className="text-gray-400 text-sm mb-5">{t('booking.startRenting')}</p>
                                <Link href="/browse">
                                    <Button className="bg-green-700 hover:bg-green-800 text-white rounded-xl">
                                        <Search className="h-4 w-4 mr-2" /> {t('dashboard.browseEquipment')}
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {active.map(b => <BookingCard key={getId(b)} b={b} />)}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="history" className="mt-4">
                        {history.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-center">
                                <div className="bg-gray-50 rounded-full h-16 w-16 flex items-center justify-center mb-4">
                                    <CheckCircle2 className="h-8 w-8 text-gray-200" />
                                </div>
                                <p className="text-gray-400 text-sm">{t('dashboard.completedEmpty')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {history.map(b => <BookingCard key={getId(b)} b={b} />)}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>

                {/* Browse CTA banner */}
                <Link href="/browse">
                    <div className="bg-gradient-to-r from-green-700 to-emerald-600 rounded-2xl p-5 flex items-center justify-between group hover:shadow-lg transition-shadow cursor-pointer">
                        <div>
                            <p className="text-green-100 text-xs font-semibold uppercase tracking-wider mb-1">{t('dashboard.readyToFarm')}</p>
                            <p className="text-white font-black text-lg">{t('dashboard.findNearby')}</p>
                            <p className="text-green-200 text-sm mt-0.5">{t('dashboard.verifiedMachines')}</p>
                        </div>
                        <div className="bg-white/20 rounded-2xl p-3 group-hover:bg-white/30 transition-colors">
                            <ChevronRight className="h-6 w-6 text-white" />
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    );
}
