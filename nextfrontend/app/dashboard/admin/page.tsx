'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Users, Package, IndianRupee, Clock, CheckCircle2, XCircle,
    Loader2, Shield, AlertTriangle, TrendingUp, Eye, Gavel, MapPin, Star,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=100&q=60';

interface Stats {
    overview: {
        totalMachines: number; availableMachines: number; pendingApprovals: number;
        totalBookings: number; recentBookings: number; activeBookings: number;
        totalUsers?: number; totalOwners?: number;
    };
    revenue: { last30Days: number; avgBookingValue: number; platformFee: number };
    topMachines?: any[];
}

interface Machine {
    _id: string; name: string; type: string; status: string; isApproved: boolean;
    pricing?: { baseRatePerDay?: number };
    location?: { district?: string; state?: string };
    images?: string[];
    ratings?: { average?: number };
    owner?: { name?: string };
    createdAt?: string;
}

interface Booking {
    _id: string; status: string;
    startDate?: string; start_date?: string;
    endDate?: string;   end_date?: string;
    totalAmount?: number; total_amount?: number;
    machine?: { name?: string };
    equipment?: { name?: string };
    renter?: { name?: string; email?: string };
}

function safeDate(s?: string) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
}

const BOOKING_STATUS: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    requested: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-green-100 text-green-700',
    accepted: 'bg-indigo-100 text-indigo-700',
    in_progress: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
    completed: 'bg-gray-100 text-gray-600',
};

function KPICard({ label, value, sub, icon: Icon, trend, color }: {
    label: string; value: string | number; sub?: string;
    icon: React.ElementType; trend?: string; color: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between mb-3">
                <div className={cn('p-2.5 rounded-xl', color)}>
                    <Icon className="h-5 w-5" />
                </div>
                {trend && <span className="text-xs text-green-600 font-semibold bg-green-50 px-2 py-0.5 rounded-full">{trend}</span>}
            </div>
            <div className="text-2xl font-black text-gray-900 mb-0.5">{value}</div>
            <div className="text-sm font-semibold text-gray-700">{label}</div>
            {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
        </div>
    );
}

export default function AdminDashboard() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();
    const { t } = useLanguage();

    useEffect(() => {
        if (!authLoading && user?.role !== 'admin') router.replace('/dashboard/farmer');
    }, [authLoading, user, router]);

    const [stats, setStats]     = useState<Stats | null>(null);
    const [machines, setMachines] = useState<Machine[]>([]);
    const [pending, setPending]   = useState<Machine[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading]   = useState(true);
    const [acting, setActing]     = useState<string | null>(null);

    const loadData = useCallback(() => {
        setLoading(true);
        Promise.all([
            nodeApi.get<any>('/admin/dashboard'),
            nodeApi.get<any>('/admin/machines?approved=false&limit=20'),
            nodeApi.get<any>('/admin/machines?approved=true&limit=20'),
            nodeApi.get<any>('/admin/bookings?limit=20'),
        ]).then(([sRes, pendRes, mRes, bRes]) => {
            setStats(sRes?.data ?? sRes);
            setPending(pendRes?.data ?? []);
            setMachines(mRes?.data ?? []);
            setBookings(bRes?.data ?? []);
        }).catch(() => toast.error(t('admin.loadError')))
            .finally(() => setLoading(false));
    }, []);

    useEffect(loadData, [loadData]);

    const handleApprove = async (id: string) => {
        setActing(id);
        try {
            await nodeApi.patch(`/admin/machines/${id}/approve`, {});
            setPending(prev => prev.filter(m => m._id !== id));
            setMachines(prev => prev.map(m => m._id === id ? { ...m, isApproved: true, status: 'available' } : m));
            toast.success(t('admin.approveSuccess'));
        } catch { toast.error(t('admin.approveFailed')); } finally { setActing(null); }
    };

    const handleReject = async (id: string) => {
        setActing(id);
        try {
            await nodeApi.patch(`/admin/machines/${id}/reject`, {});
            setPending(prev => prev.filter(m => m._id !== id));
            toast.success(t('admin.rejectSuccess'));
        } catch { toast.error(t('admin.rejectFailed')); } finally { setActing(null); }
    };

    if (authLoading) return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
            <Loader2 className="h-10 w-10 animate-spin text-red-600" />
        </div>
    );

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white px-4 lg:px-8 py-8">
                <div className="container mx-auto max-w-screen-xl">
                    <div className="flex items-start justify-between gap-4 mb-6">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <Shield className="h-5 w-5 text-red-400" />
                                <span className="text-slate-300 text-sm font-semibold uppercase tracking-wider">{t('admin.console')}</span>
                            </div>
                            <h1 className="text-2xl lg:text-3xl font-black">{t('admin.platformDashboard')}</h1>
                            <p className="text-slate-300 text-sm mt-1">{t('admin.opsOverview')}</p>
                        </div>
                        {pending.length > 0 && (
                            <div className="bg-red-500/20 border border-red-400/30 rounded-2xl px-4 py-3 flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-red-300" />
                                <div>
                                    <p className="text-white font-bold text-sm">{t('admin.pendingCount', { count: String(pending.length) })}</p>
                                    <p className="text-red-200 text-xs">{t('admin.equipmentApprovals')}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Revenue bar */}
                    {stats && (
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-white/10 rounded-2xl p-4 border border-white/20">
                                <p className="text-slate-300 text-xs font-semibold uppercase mb-1">{t('admin.revenue30')}</p>
                                <p className="text-2xl font-black text-white">₹{stats.revenue.last30Days.toLocaleString('en-IN')}</p>
                            </div>
                            <div className="bg-white/10 rounded-2xl p-4 border border-white/20">
                                <p className="text-slate-300 text-xs font-semibold uppercase mb-1">{t('admin.platformFee')}</p>
                                <p className="text-2xl font-black text-white">₹{stats.revenue.platformFee.toLocaleString('en-IN')}</p>
                            </div>
                            <div className="bg-white/10 rounded-2xl p-4 border border-white/20">
                                <p className="text-slate-300 text-xs font-semibold uppercase mb-1">{t('admin.avgBooking')}</p>
                                <p className="text-2xl font-black text-white">₹{stats.revenue.avgBookingValue.toLocaleString('en-IN')}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 max-w-screen-xl py-6 space-y-6">
                {/* KPIs */}
                {loading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
                    </div>
                ) : stats ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KPICard label={t('admin.totalEquipment')}  value={stats.overview.totalMachines}   icon={Package}    color="bg-blue-50 text-blue-700"   sub={t('admin.availableCount', { count: String(stats.overview.availableMachines) })} />
                        <KPICard label={t('admin.totalBookings')}   value={stats.overview.totalBookings}   icon={Clock}      color="bg-amber-50 text-amber-700"  sub={t('admin.activeCount', { count: String(stats.overview.activeBookings) })} />
                        <KPICard label={t('admin.pendingApproval')} value={stats.overview.pendingApprovals} icon={AlertTriangle} color="bg-red-50 text-red-600" sub={t('admin.needReview')} trend={stats.overview.pendingApprovals > 0 ? t('admin.actionNeeded') : undefined} />
                        <KPICard label={t('admin.platformRevenue')} value={`₹${stats.revenue.platformFee.toLocaleString('en-IN')}`} icon={TrendingUp} color="bg-green-50 text-green-700" sub={t('admin.last30Days')} />
                    </div>
                ) : null}

                {/* Main content */}
                <Tabs defaultValue={pending.length > 0 ? 'approvals' : 'bookings'}>
                    <TabsList className="bg-white rounded-xl border border-gray-100 shadow-sm p-1 h-auto">
                        <TabsTrigger value="approvals" className="rounded-lg text-sm font-semibold data-[state=active]:bg-slate-800 data-[state=active]:text-white">
                            {t('admin.approvals')}
                            {pending.length > 0 && (
                                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{pending.length}</span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="bookings" className="rounded-lg text-sm font-semibold data-[state=active]:bg-slate-800 data-[state=active]:text-white">
                            {t('admin.bookingsTab')} ({bookings.length})
                        </TabsTrigger>
                        <TabsTrigger value="equipment" className="rounded-lg text-sm font-semibold data-[state=active]:bg-slate-800 data-[state=active]:text-white">
                            {t('admin.equipmentTab')} ({machines.length})
                        </TabsTrigger>
                        <TabsTrigger value="users" className="rounded-lg text-sm font-semibold data-[state=active]:bg-slate-800 data-[state=active]:text-white">
                            {t('admin.usersTab')}
                        </TabsTrigger>
                    </TabsList>

                    {/* Approvals tab */}
                    <TabsContent value="approvals" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
                        ) : pending.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center py-16 text-center">
                                <CheckCircle2 className="h-12 w-12 text-green-300 mb-3" />
                                <h3 className="font-bold text-gray-700">{t('admin.allCaughtUp')}</h3>
                                <p className="text-gray-400 text-sm mt-1">{t('admin.noPendingApprovals')}</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {pending.map(m => (
                                    <div key={m._id} className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
                                        <div className="flex gap-0">
                                            <div className="w-20 flex-shrink-0 overflow-hidden bg-gray-100">
                                                <img src={m.images?.[0] ?? FALLBACK} alt={m.name}
                                                    className="w-full h-full object-cover"
                                                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                            </div>
                                            <div className="flex-1 p-4 min-w-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <h3 className="font-bold text-gray-900 text-sm line-clamp-1">{m.name}</h3>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                                            <span className="capitalize">{m.type?.replace(/-/g, ' ')}</span>
                                                            {m.location?.district && <><span>·</span><MapPin className="h-3 w-3 text-green-600" />{m.location.district}</>}
                                                            {m.pricing?.baseRatePerDay && <><span>·</span><IndianRupee className="h-3 w-3" />{m.pricing.baseRatePerDay.toLocaleString('en-IN')}/day</>}
                                                        </div>
                                                        {m.owner?.name && (
                                                            <p className="text-xs text-gray-400 mt-0.5">{t('admin.owner')}: {m.owner.name}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2 flex-shrink-0">
                                                        <Button size="sm" className="h-8 text-xs bg-green-700 hover:bg-green-800 gap-1"
                                                            disabled={acting === m._id} onClick={() => handleApprove(m._id)}>
                                                            {acting === m._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                                            {t('admin.approve')}
                                                        </Button>
                                                        <Button size="sm" variant="outline" className="h-8 text-xs border-red-200 text-red-500 hover:bg-red-50 gap-1"
                                                            disabled={acting === m._id} onClick={() => handleReject(m._id)}>
                                                            <XCircle className="h-3.5 w-3.5" /> {t('admin.reject')}
                                                        </Button>
                                                        <Button size="sm" variant="ghost" className="h-8 text-xs px-2" asChild>
                                                            <a href={`/equipment/${m._id}`} target="_blank" rel="noopener noreferrer" title={`View ${m.name}`} aria-label={`View ${m.name}`}>
                                                                <Eye className="h-3.5 w-3.5" />
                                                            </a>
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* Bookings tab */}
                    <TabsContent value="bookings" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
                        ) : bookings.length === 0 ? (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center py-16 text-center">
                                <Clock className="h-12 w-12 text-gray-200 mb-3" />
                                <p className="text-gray-400">{t('admin.noBookingsYet')}</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50">
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colEquipment')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colRenter')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colDates')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colAmount')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colStatus')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {bookings.map(b => (
                                                <tr key={b._id} className="hover:bg-gray-50/50">
                                                    <td className="px-4 py-3 font-medium text-gray-900 line-clamp-1 max-w-[180px]">
                                                        {b.equipment?.name ?? b.machine?.name ?? '—'}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600">{b.renter?.name ?? '—'}</td>
                                                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                                                        {safeDate(b.start_date ?? b.startDate)}
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-green-700">
                                                        ₹{(b.total_amount ?? b.totalAmount ?? 0).toLocaleString('en-IN')}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full capitalize', BOOKING_STATUS[b.status] ?? 'bg-gray-100 text-gray-600')}>
                                                            {b.status?.replace('_', ' ')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    {/* All equipment tab */}
                    <TabsContent value="equipment" className="mt-4">
                        {loading ? (
                            <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
                        ) : (
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50">
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colEquipment')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colLocation')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colRate')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colRating')}</th>
                                                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase">{t('admin.colStatus')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {machines.map(m => (
                                                <tr key={m._id} className="hover:bg-gray-50/50">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                                                                <img src={m.images?.[0] ?? FALLBACK} alt="" className="w-full h-full object-cover"
                                                                    onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                                            </div>
                                                            <span className="font-medium text-gray-900 line-clamp-1 max-w-[160px]">{m.name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-500 text-xs">{m.location?.district ?? '—'}</td>
                                                    <td className="px-4 py-3 font-semibold text-green-700 text-xs">
                                                        {m.pricing?.baseRatePerDay ? `₹${m.pricing.baseRatePerDay.toLocaleString('en-IN')}/day` : '—'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {(m.ratings?.average ?? 0) > 0
                                                            ? <span className="flex items-center gap-0.5 text-xs"><Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />{m.ratings!.average!.toFixed(1)}</span>
                                                            : <span className="text-xs text-gray-300">—</span>}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full',
                                                            m.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                                                            {m.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    {/* Users tab */}
                    <TabsContent value="users" className="mt-4">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
                            <div className="bg-slate-50 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                                <Users className="h-8 w-8 text-slate-300" />
                            </div>
                            <h3 className="font-bold text-gray-700 mb-1">{t('admin.userManagement')}</h3>
                            <p className="text-sm text-gray-400 max-w-sm mx-auto">
                                {t('admin.userManagementDesc')}
                            </p>
                            <div className="mt-6 grid grid-cols-3 gap-4 max-w-sm mx-auto">
                                {[
                                    { label: t('admin.totalUsers'), icon: Users },
                                    { label: t('admin.kycPending'), icon: Gavel },
                                    { label: t('admin.disputes'),   icon: AlertTriangle },
                                ].map(({ label, icon: Icon }) => (
                                    <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                                        <Icon className="h-5 w-5 text-gray-300 mx-auto mb-1" />
                                        <p className="text-xs text-gray-400">{label}</p>
                                        <p className="text-lg font-black text-gray-200">—</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
