'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Package, Clock, IndianRupee, CheckCircle2, XCircle, Loader2, PlusCircle,
    Star, Pencil, Trash2, Calendar, MapPin, User, TrendingUp,
    BarChart3, Tag, Navigation, NavigationOff,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { getMachineId, type Machine as BaseMachine } from '@/lib/getMachineId';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=400&q=60';

interface Booking {
    id?: string; _id?: string;
    status: string;
    startDate?: string; start_date?: string;
    endDate?: string;   end_date?: string;
    totalAmount?: number; total_amount?: number;
    farmerName?: string;
    renter?: { name?: string; email?: string; phone?: string };
    machine?: { _id?: string; id?: string; name?: string; images?: string[] };
    equipment?: { name?: string; images?: string[] };
}

interface Machine extends BaseMachine {
    type: string;
    status: string;
    pricing?: { baseRatePerDay?: number };
    images?: string[];
    location?: { district?: string; state?: string };
    ratings?: { average?: number; count?: number };
    totalBookings?: number;
    totalRevenue?: number;
}

function safeDate(s?: string) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
}

function SkeletonCard() {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <Skeleton className="h-36 w-full" />
            <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-7 w-full mt-1" />
            </div>
        </div>
    );
}

export default function OwnerDashboard() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [machines, setMachines]       = useState<Machine[]>([]);
    const [incoming, setIncoming]       = useState<Booking[]>([]);
    const [activeBookings, setActive]   = useState<Booking[]>([]);
    const [loading, setLoading]         = useState(true);
    const [acting, setActing]           = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [broadcasting, setBroadcasting] = useState<Set<string>>(new Set());
    const gpsWatchRef = useRef<Map<string, number>>(new Map());

    const fetchData = useCallback(() => {
        setLoading(true);
        Promise.all([
            nodeApi.get<any>('/machines?owner=me').catch(() => ({ data: [] })),
            nodeApi.get<any>('/bookings/incoming?status=pending').catch(() => ({ bookings: [] })),
            nodeApi.get<any>('/bookings/incoming?status=confirmed').catch(() => ({ bookings: [] })),
        ]).then(([mRes, bRes, aRes]) => {
            setMachines(mRes?.data ?? mRes?.machines ?? []);
            const raw = bRes?.bookings ?? bRes?.data ?? [];
            setIncoming(Array.isArray(raw) ? raw : []);
            const activeRaw = aRes?.bookings ?? aRes?.data ?? [];
            setActive(Array.isArray(activeRaw) ? activeRaw : []);
        }).catch(() => toast.error(t('dashboard.loadDashboardError')))
            .finally(() => setLoading(false));
    }, []);

    const startGps = (bookingId: string) => {
        if (!navigator.geolocation) { toast.error('GPS not supported by this browser'); return; }
        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                nodeApi.post('/tracking/driver-location', {
                    bookingId,
                    latitude:  pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    heading:   pos.coords.heading,
                    speed:     pos.coords.speed,
                    accuracy:  pos.coords.accuracy,
                }).catch(() => {});
            },
            (err) => { toast.error(`GPS error: ${err.message}`); stopGps(bookingId); },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        gpsWatchRef.current.set(bookingId, watchId);
        setBroadcasting(prev => new Set([...prev, bookingId]));
        toast.success('GPS tracking started — renter can now see your location');
    };

    const stopGps = (bookingId: string) => {
        const watchId = gpsWatchRef.current.get(bookingId);
        if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
        gpsWatchRef.current.delete(bookingId);
        setBroadcasting(prev => { const s = new Set(prev); s.delete(bookingId); return s; });
    };

    useEffect(fetchData, [fetchData]);

    const handleAction = async (bookingId: string, action: 'accept' | 'reject') => {
        setActing(bookingId);
        try {
            await nodeApi.patch(`/bookings/${bookingId}/${action}`, {});
            toast.success(action === 'accept' ? t('dashboard.bookingAccepted') : t('dashboard.bookingRejected'));
            fetchData();
        } catch {
            toast.error(t('dashboard.actionFailed'));
        } finally { setActing(null); }
    };

    const handleDelete = async (mid: string) => {
        setActing(mid);
        setDeleteConfirm(null);
        try {
            await nodeApi.delete(`/machines/${mid}`);
            toast.success(t('dashboard.equipmentRemoved'));
            setMachines(prev => prev.filter(m => getMachineId(m) !== mid));
        } catch {
            toast.error(t('dashboard.deleteFailed'));
        } finally { setActing(null); }
    };

    const available = machines.filter(m => m.status === 'available').length;
    const totalRevenue = machines.reduce((s, m) => s + (m.totalRevenue ?? (m.totalBookings ?? 0) * (m.pricing?.baseRatePerDay ?? 0)), 0);

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-gradient-to-br from-indigo-700 to-indigo-900 text-white px-4 lg:px-8 py-8">
                <div className="container mx-auto max-w-screen-xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                            <p className="text-indigo-200 text-sm font-medium mb-1">{t('dashboard.myEquipment')}</p>
                            <h1 className="text-2xl lg:text-3xl font-black">{user?.name || 'Owner'} 🚜</h1>
                            <p className="text-indigo-200 text-sm mt-1">{t('dashboard.incomingRequests')}</p>
                        </div>
                        <Link href="/add-equipment">
                            <Button className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl shadow-md gap-1.5">
                                <PlusCircle className="h-4 w-4" /> {t('dashboard.addEquipment')}
                            </Button>
                        </Link>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                            { label: t('dashboard.myEquipment'),   value: machines.length,      icon: Package     },
                            { label: t('dashboard.pendingApproval'), value: incoming.length,    icon: Clock       },
                            { label: t('dashboard.available'),      value: available,            icon: CheckCircle2},
                            { label: t('dashboard.totalRevenue'),   value: totalRevenue > 0 ? `₹${(totalRevenue/1000).toFixed(1)}k` : '—', icon: TrendingUp },
                        ].map(s => (
                            <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                                <div className="flex items-center justify-between mb-2">
                                    <s.icon className="h-5 w-5 text-indigo-200" />
                                </div>
                                <div className="text-2xl font-black text-white">{s.value}</div>
                                <div className="text-xs text-indigo-200 mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 max-w-screen-xl py-6">
                {/* Quick links */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                    {[
                        { href: '/offers',         icon: Tag,       label: t('nav.offers'),         color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
                        { href: '/analytics',      icon: BarChart3, label: t('dashboard.analytics'), color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
                        { href: '/add-equipment',  icon: PlusCircle, label: t('dashboard.addEquipment'), color: 'bg-green-50 text-green-700 hover:bg-green-100' },
                    ].map(a => (
                        <Link key={a.href} href={a.href}>
                            <div className={cn('flex flex-col items-center gap-2 py-4 rounded-2xl text-sm font-semibold transition-colors cursor-pointer', a.color)}>
                                <a.icon className="h-6 w-6" />
                                <span className="text-xs">{a.label}</span>
                            </div>
                        </Link>
                    ))}
                </div>

                <Tabs defaultValue="requests">
                    <TabsList className="bg-white rounded-xl border border-gray-100 shadow-sm p-1 h-auto">
                        <TabsTrigger value="requests" className="rounded-lg text-sm font-semibold data-[state=active]:bg-indigo-700 data-[state=active]:text-white">
                            {t('dashboard.requestsTab')}
                            {incoming.length > 0 && (
                                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{incoming.length}</span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="active" className="rounded-lg text-sm font-semibold data-[state=active]:bg-indigo-700 data-[state=active]:text-white">
                            Active
                            {activeBookings.length > 0 && (
                                <span className="ml-1.5 bg-green-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{activeBookings.length}</span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="fleet" className="rounded-lg text-sm font-semibold data-[state=active]:bg-indigo-700 data-[state=active]:text-white">
                            {t('dashboard.equipmentTab')} ({machines.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* Booking Requests */}
                    <TabsContent value="requests" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}</div>
                        ) : incoming.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center py-16 text-center">
                                <div className="bg-amber-50 rounded-full h-16 w-16 flex items-center justify-center mb-4">
                                    <Clock className="h-8 w-8 text-amber-300" />
                                </div>
                                <h3 className="font-bold text-gray-700 mb-1">{t('dashboard.noPendingRequests')}</h3>
                                <p className="text-gray-400 text-sm">{t('dashboard.incomingRequests')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {incoming.map(b => {
                                    const id         = b.id ?? b._id ?? '';
                                    const machineName = b.equipment?.name ?? b.machine?.name ?? 'Equipment';
                                    const img        = (b.equipment?.images ?? b.machine?.images ?? [])[0] ?? FALLBACK;
                                    const renterName  = b.renter?.name ?? b.farmerName ?? 'Farmer';
                                    const start       = b.start_date ?? b.startDate ?? '';
                                    const end         = b.end_date ?? b.endDate ?? '';
                                    const amt         = b.total_amount ?? b.totalAmount ?? 0;

                                    return (
                                        <div key={id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                            <div className="flex gap-0">
                                                <div className="w-20 flex-shrink-0 overflow-hidden bg-gray-100">
                                                    <img src={img} alt={machineName} className="w-full h-full object-cover"
                                                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                                </div>
                                                <div className="flex-1 p-4 min-w-0">
                                                    <div className="flex items-start justify-between gap-2 mb-1">
                                                        <h3 className="font-bold text-sm text-gray-900 line-clamp-1">{machineName}</h3>
                                                        <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] font-bold flex-shrink-0">
                                                            <Clock className="h-2.5 w-2.5 mr-1" /> {t('dashboard.statusPending')}
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                                                        <User className="h-3 w-3 text-indigo-600" />
                                                        <span className="font-medium text-gray-700">{renterName}</span>
                                                        {b.renter?.phone && <span className="text-gray-400">· {b.renter.phone}</span>}
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                                                        <Calendar className="h-3 w-3 text-green-600" />
                                                        {safeDate(start)} → {safeDate(end)}
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-0.5 font-black text-green-700 text-sm">
                                                            <IndianRupee className="h-3 w-3" />{amt.toLocaleString('en-IN')}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <Button size="sm" className="h-8 text-xs bg-green-700 hover:bg-green-800 gap-1"
                                                                disabled={acting === id} onClick={() => handleAction(id, 'accept')}>
                                                                {acting === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                                                {t('dashboard.approve')}
                                                            </Button>
                                                            <Button size="sm" variant="outline" className="h-8 text-xs border-red-200 text-red-500 hover:bg-red-50 gap-1"
                                                                disabled={acting === id} onClick={() => handleAction(id, 'reject')}>
                                                                <XCircle className="h-3.5 w-3.5" /> {t('dashboard.reject')}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>

                    {/* Active Deliveries — GPS Broadcast */}
                    <TabsContent value="active" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}</div>
                        ) : activeBookings.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center py-16 text-center">
                                <div className="bg-green-50 rounded-full h-16 w-16 flex items-center justify-center mb-4">
                                    <Navigation className="h-8 w-8 text-green-300" />
                                </div>
                                <h3 className="font-bold text-gray-700 mb-1">No active deliveries</h3>
                                <p className="text-gray-400 text-sm">Confirmed bookings will appear here with GPS controls</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {activeBookings.map(b => {
                                    const id          = b.id ?? b._id ?? '';
                                    const machineName = b.equipment?.name ?? b.machine?.name ?? 'Equipment';
                                    const img         = (b.equipment?.images ?? b.machine?.images ?? [])[0] ?? FALLBACK;
                                    const renterName  = b.renter?.name ?? b.farmerName ?? 'Farmer';
                                    const start       = b.start_date ?? b.startDate ?? '';
                                    const end         = b.end_date ?? b.endDate ?? '';
                                    const isOn        = broadcasting.has(id);
                                    return (
                                        <div key={id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                            <div className="flex gap-0">
                                                <div className="w-20 flex-shrink-0 overflow-hidden bg-gray-100">
                                                    <img src={img} alt={machineName} className="w-full h-full object-cover"
                                                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                                </div>
                                                <div className="flex-1 p-4 min-w-0">
                                                    <div className="flex items-start justify-between gap-2 mb-1">
                                                        <h3 className="font-bold text-sm text-gray-900 line-clamp-1">{machineName}</h3>
                                                        <Badge className="bg-green-100 text-green-700 border-0 text-[10px] font-bold flex-shrink-0">
                                                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Confirmed
                                                        </Badge>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                                                        <User className="h-3 w-3 text-indigo-600" />
                                                        <span className="font-medium text-gray-700">{renterName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                                                        <Calendar className="h-3 w-3 text-green-600" />
                                                        {safeDate(start)} → {safeDate(end)}
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        {isOn && (
                                                            <span className="text-xs text-green-600 font-semibold flex items-center gap-1">
                                                                <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                                                Broadcasting live
                                                            </span>
                                                        )}
                                                        <div className="flex gap-2 ml-auto">
                                                            <Button
                                                                size="sm"
                                                                className={`h-8 text-xs gap-1 ${isOn ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-700 hover:bg-indigo-800'}`}
                                                                onClick={() => isOn ? stopGps(id) : startGps(id)}
                                                            >
                                                                {isOn
                                                                    ? <><NavigationOff className="h-3.5 w-3.5" /> Stop GPS</>
                                                                    : <><Navigation className="h-3.5 w-3.5" /> Start GPS</>}
                                                            </Button>
                                                            <Link href={`/tracking/${id}`}>
                                                                <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                                                                    <MapPin className="h-3 w-3" /> Map
                                                                </Button>
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>

                    {/* My Fleet */}
                    <TabsContent value="fleet" className="mt-4">
                        {loading ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                            </div>
                        ) : machines.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center py-16 text-center">
                                <div className="bg-indigo-50 rounded-full h-16 w-16 flex items-center justify-center mb-4">
                                    <Package className="h-8 w-8 text-indigo-200" />
                                </div>
                                <h3 className="font-bold text-gray-700 mb-2">{t('dashboard.noEquipment')}</h3>
                                <p className="text-gray-400 text-sm mb-5">{t('dashboard.listFirstEquipment')}</p>
                                <Link href="/add-equipment">
                                    <Button className="bg-indigo-700 hover:bg-indigo-800 text-white rounded-xl gap-1.5">
                                        <PlusCircle className="h-4 w-4" /> {t('dashboard.addEquipment')}
                                    </Button>
                                </Link>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {machines.map(m => {
                                    const id = getMachineId(m) ?? '';
                                    const isAvail = m.status === 'available';
                                    return (
                                        <div key={id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
                                            <div className="relative h-36 bg-gray-100">
                                                <img src={m.images?.[0] ?? FALLBACK} alt={m.name}
                                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                                <Badge className={cn('absolute top-2 right-2 text-[10px] font-bold border-0',
                                                    isAvail ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                                                    {isAvail ? `✓ ${t('dashboard.available')}` : `✗ ${t('dashboard.unavailable')}`}
                                                </Badge>
                                            </div>
                                            <div className="p-4">
                                                <h3 className="font-bold text-gray-900 text-sm line-clamp-1 mb-1">{m.name}</h3>
                                                {m.location?.district && (
                                                    <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
                                                        <MapPin className="h-3 w-3 text-green-600" /> {m.location.district}
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-0.5 text-green-700 font-extrabold text-sm">
                                                        <IndianRupee className="h-3 w-3" />
                                                        {m.pricing?.baseRatePerDay?.toLocaleString('en-IN') ?? '—'}{t('dashboard.perDay')}
                                                    </div>
                                                    {(m.ratings?.average ?? 0) > 0 && (
                                                        <div className="flex items-center gap-0.5 text-xs text-gray-500">
                                                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                                            <span className="font-semibold text-gray-700">{m.ratings!.average!.toFixed(1)}</span>
                                                            <span className="text-gray-400">({m.ratings!.count ?? 0})</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {deleteConfirm === id ? (
                                                    <div className="flex gap-1.5">
                                                        <Button size="sm" variant="destructive" className="flex-1 h-8 text-xs"
                                                            disabled={acting === id} onClick={() => handleDelete(id)}>
                                                            {acting === id ? <Loader2 className="h-3 w-3 animate-spin" /> : t('dashboard.delete')}
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="h-8 text-xs"
                                                            onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-1.5">
                                                        <Link href={`/equipment/${id}`} className="flex-1">
                                                            <Button size="sm" variant="outline" className="w-full h-8 text-xs">{t('dashboard.viewDetails')}</Button>
                                                        </Link>
                                                        <Link href={`/edit-equipment/${id}`}>
                                                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 px-3">
                                                                <Pencil className="h-3 w-3" />
                                                            </Button>
                                                        </Link>
                                                        <Button size="sm" variant="outline"
                                                            className="h-8 text-xs gap-1 px-3 border-red-200 text-red-500 hover:bg-red-50"
                                                            onClick={() => setDeleteConfirm(id)}>
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
