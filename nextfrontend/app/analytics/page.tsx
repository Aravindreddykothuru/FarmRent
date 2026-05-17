'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import {
    IndianRupee, Package, CalendarCheck, Star, TrendingUp,
    ArrowLeft, BarChart3, CheckCircle2, Clock, XCircle, AlertCircle,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Machine {
    id?: string; _id?: string;
    name: string;
    type: string;
    status: string;
    pricing?: { baseRatePerDay?: number };
    ratings?: { average?: number; count?: number };
    totalBookings?: number;
    totalRevenue?: number;
}

interface Booking {
    id?: string; _id?: string;
    status: string;
    startDate?: string; start_date?: string;
    endDate?: string;   end_date?: string;
    totalAmount?: number; total_amount?: number;
    machine?: { name?: string };
    equipment?: { name?: string };
}

function StatCard({ icon, label, value, sub, color }: {
    icon: React.ReactNode; label: string; value: string | number; sub?: string; color: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                {icon}
            </div>
            <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
                {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
            </div>
        </div>
    );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="flex items-center gap-3">
            <p className="text-sm text-gray-700 w-36 truncate shrink-0">{label}</p>
            <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%`, transition: 'width 0.6s ease' }} />
            </div>
            <p className="text-sm font-semibold text-gray-800 w-20 text-right shrink-0">
                ₹{value.toLocaleString('en-IN')}
            </p>
        </div>
    );
}

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    confirmed:  { label: 'Confirmed',  color: 'bg-blue-100 text-blue-700',   icon: <CheckCircle2 className="w-4 h-4" /> },
    completed:  { label: 'Completed',  color: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-4 h-4" /> },
    pending:    { label: 'Pending',    color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-4 h-4" /> },
    cancelled:  { label: 'Cancelled', color: 'bg-red-100 text-red-700',    icon: <XCircle className="w-4 h-4" /> },
    disputed:   { label: 'Disputed',  color: 'bg-orange-100 text-orange-700', icon: <AlertCircle className="w-4 h-4" /> },
};

export default function AnalyticsPage() {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const [machines, setMachines] = useState<Machine[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading) return;
        if (!user) { router.replace('/login'); return; }
        if (user.role === 'farmer') { router.replace('/dashboard'); return; }

        Promise.all([
            nodeApi.get<any>('/machines?owner=me').catch(() => ({ data: [] })),
            nodeApi.get<any>('/bookings/incoming').catch(() => ({ bookings: [] })),
        ]).then(([mRes, bRes]) => {
            setMachines(mRes?.data ?? mRes?.machines ?? []);
            setBookings(bRes?.bookings ?? bRes?.data ?? []);
        }).finally(() => setLoading(false));
    }, [user, authLoading, router]);

    // ── Derived metrics ───────────────────────────────────────────────────────
    const totalRevenue = machines.reduce((sum, m) => sum + (m.totalRevenue ?? 0), 0);
    const totalBookings = bookings.length;
    const avgRating = machines.length
        ? machines.reduce((s, m) => s + (m.ratings?.average ?? 0), 0) / machines.filter(m => (m.ratings?.average ?? 0) > 0).length || 0
        : 0;

    const statusCounts = bookings.reduce<Record<string, number>>((acc, b) => {
        const s = b.status ?? 'unknown';
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
    }, {});

    // Revenue per machine (sorted desc)
    const machineRevenue = machines
        .map(m => ({ name: m.name, revenue: m.totalRevenue ?? 0 }))
        .sort((a, b) => b.revenue - a.revenue);
    const maxRevenue = machineRevenue[0]?.revenue ?? 0;

    // Monthly revenue from booking amounts
    const monthlyRevenue: Record<string, number> = {};
    bookings.forEach(b => {
        if (b.status !== 'completed' && b.status !== 'confirmed') return;
        const dateStr = b.startDate ?? b.start_date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return;
        const key = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        monthlyRevenue[key] = (monthlyRevenue[key] ?? 0) + (b.totalAmount ?? b.total_amount ?? 0);
    });
    const months = Object.entries(monthlyRevenue).slice(-6);
    const maxMonthly = Math.max(...months.map(([, v]) => v), 1);

    if (loading || authLoading) {
        return (
            <div className="min-h-screen bg-[#F7F8FA] p-6">
                <div className="max-w-5xl mx-auto space-y-6">
                    <Skeleton className="h-8 w-48" />
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
                    </div>
                    <Skeleton className="h-64 rounded-2xl" />
                    <Skeleton className="h-64 rounded-2xl" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 px-6 py-4">
                <div className="max-w-5xl mx-auto flex items-center gap-3">
                    <Link href="/dashboard" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600" />
                    </Link>
                    <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-green-700" />
                        <h1 className="text-lg font-bold text-gray-900">Analytics</h1>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto p-6 space-y-6">

                {/* Summary cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        icon={<IndianRupee className="w-5 h-5 text-green-700" />}
                        label="Total Revenue"
                        value={`₹${totalRevenue.toLocaleString('en-IN')}`}
                        sub="All time"
                        color="bg-green-50"
                    />
                    <StatCard
                        icon={<CalendarCheck className="w-5 h-5 text-blue-600" />}
                        label="Total Bookings"
                        value={totalBookings}
                        sub={`${statusCounts['completed'] ?? 0} completed`}
                        color="bg-blue-50"
                    />
                    <StatCard
                        icon={<Package className="w-5 h-5 text-purple-600" />}
                        label="Equipment"
                        value={machines.length}
                        sub={`${machines.filter(m => m.status === 'available').length} available`}
                        color="bg-purple-50"
                    />
                    <StatCard
                        icon={<Star className="w-5 h-5 text-yellow-500" />}
                        label="Avg Rating"
                        value={avgRating > 0 ? avgRating.toFixed(1) : '—'}
                        sub="Across all equipment"
                        color="bg-yellow-50"
                    />
                </div>

                {/* Booking status breakdown */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Booking Status</h2>
                    {totalBookings === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-6">No bookings yet</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {Object.entries(STATUS_META).map(([status, meta]) => {
                                const count = statusCounts[status] ?? 0;
                                return (
                                    <div key={status} className={`rounded-xl p-4 text-center ${meta.color} bg-opacity-60`}>
                                        <div className="flex justify-center mb-1">{meta.icon}</div>
                                        <p className="text-2xl font-bold">{count}</p>
                                        <p className="text-xs font-medium mt-0.5">{meta.label}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Revenue by equipment */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5">Revenue by Equipment</h2>
                    {machineRevenue.length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-6">No equipment added yet</p>
                    ) : (
                        <div className="space-y-4">
                            {machineRevenue.map((m, i) => (
                                <BarRow
                                    key={i}
                                    label={m.name}
                                    value={m.revenue}
                                    max={maxRevenue}
                                    color={i === 0 ? 'bg-green-500' : i === 1 ? 'bg-blue-400' : 'bg-gray-300'}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Monthly revenue trend */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5">Monthly Revenue Trend</h2>
                    {months.length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-6">No completed bookings yet</p>
                    ) : (
                        <div className="flex items-end gap-3 h-40">
                            {months.map(([month, rev]) => {
                                const pct = Math.round((rev / maxMonthly) * 100);
                                return (
                                    <div key={month} className="flex-1 flex flex-col items-center gap-1">
                                        <p className="text-xs font-semibold text-gray-700">
                                            ₹{rev >= 1000 ? `${(rev / 1000).toFixed(1)}k` : rev}
                                        </p>
                                        <div className="w-full flex items-end" style={{ height: '96px' }}>
                                            <div
                                                className="w-full bg-green-500 rounded-t-lg"
                                                style={{ height: `${Math.max(pct, 4)}%`, transition: 'height 0.6s ease' }}
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500">{month}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Top equipment table */}
                {machines.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-6">
                        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Equipment Performance</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                                        <th className="text-left pb-3 font-medium">Equipment</th>
                                        <th className="text-left pb-3 font-medium">Type</th>
                                        <th className="text-right pb-3 font-medium">Bookings</th>
                                        <th className="text-right pb-3 font-medium">Revenue</th>
                                        <th className="text-right pb-3 font-medium">Rating</th>
                                        <th className="text-right pb-3 font-medium">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {[...machines]
                                        .sort((a, b) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0))
                                        .map((m, i) => (
                                        <tr key={i} className="hover:bg-gray-50 transition-colors">
                                            <td className="py-3 font-medium text-gray-900">{m.name}</td>
                                            <td className="py-3 text-gray-500 capitalize">{m.type?.replace(/_/g, ' ')}</td>
                                            <td className="py-3 text-right text-gray-700">{m.totalBookings ?? 0}</td>
                                            <td className="py-3 text-right font-semibold text-green-700">
                                                ₹{(m.totalRevenue ?? 0).toLocaleString('en-IN')}
                                            </td>
                                            <td className="py-3 text-right text-yellow-600">
                                                {m.ratings?.average ? `★ ${m.ratings.average.toFixed(1)}` : '—'}
                                            </td>
                                            <td className="py-3 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                                                    m.status === 'available' ? 'bg-green-100 text-green-700' :
                                                    m.status === 'rented'    ? 'bg-blue-100 text-blue-700' :
                                                    'bg-gray-100 text-gray-600'
                                                }`}>
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

                {/* Empty state */}
                {machines.length === 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
                        <TrendingUp className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                        <p className="text-gray-500 font-medium">No data yet</p>
                        <p className="text-gray-400 text-sm mt-1">Add your equipment to start tracking analytics</p>
                        <Link
                            href="/add-equipment"
                            className="inline-block mt-4 px-5 py-2.5 bg-green-700 text-white rounded-xl text-sm font-semibold hover:bg-green-800 transition-colors"
                        >
                            Add Equipment
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}
