'use client';

import { useState, useEffect } from 'react';
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Calendar, IndianRupee, Package, Clock, CheckCircle, XCircle, ExternalLink, Plus, AlertCircle } from "lucide-react";
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

interface Booking {
    id: string;
    equipment_id: string;
    start_date: string;
    end_date: string;
    status: string;
    total_amount: number;
    equipment?: {
        name: string;
        type: string;
        images?: string[];
    };
    farmer_name?: string;
}

function fmt(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtAmount(n: number) {
    return `₹${Number(n).toLocaleString('en-IN')}`;
}

function isActive(b: Booking) {
    return ['confirmed', 'active', 'in_progress'].includes(b.status);
}

function isUpcoming(b: Booking) {
    return ['requested', 'pending', 'accepted'].includes(b.status);
}

function isCompleted(b: Booking) {
    return ['completed', 'returned'].includes(b.status);
}

function BookingCardSkeleton() {
    return (
        <Card className="border-2">
            <CardContent className="p-6">
                <div className="flex gap-4">
                    <Skeleton className="h-5 w-5 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-4 w-1/2" />
                    </div>
                    <Skeleton className="h-9 w-28 flex-shrink-0" />
                </div>
            </CardContent>
        </Card>
    );
}

function EmptyBookings({ variant }: { variant: 'active' | 'past' }) {
    const { t } = useLanguage();
    return (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">
                {variant === 'active' ? t('dashboard.noActiveBookings') : t('dashboard.noPastBookings')}
            </p>
            <p className="text-gray-400 text-sm mt-1 mb-5">{t('dashboard.browseFirst')}</p>
            <Link href="/browse">
                <Button size="sm" className="bg-green-700 hover:bg-green-800">{t('dashboard.browseEquipment')}</Button>
            </Link>
        </div>
    );
}

const getStatusIcon = (status: string) => {
    const s = status.toLowerCase();
    if (['confirmed', 'active', 'in_progress'].includes(s)) return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (['requested', 'pending', 'accepted'].includes(s))   return <Clock className="h-5 w-5 text-blue-600" />;
    if (['completed', 'returned'].includes(s))              return <CheckCircle className="h-5 w-5 text-gray-400" />;
    return <XCircle className="h-5 w-5 text-red-500" />;
};

export default function DashboardPage() {
    const { user } = useAuth();
    const { t } = useLanguage();
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');

    const getStatusBadge = (status: string) => {
        const s = status.toLowerCase();
        if (['confirmed', 'active', 'in_progress'].includes(s)) return <Badge className="bg-green-600 capitalize">{s.replace('_', ' ')}</Badge>;
        if (['requested', 'pending', 'accepted'].includes(s))   return <Badge className="bg-blue-600 capitalize">{s}</Badge>;
        if (['completed', 'returned'].includes(s))              return <Badge variant="secondary">{t('booking.completed')}</Badge>;
        return <Badge variant="destructive" className="capitalize">{s.replace('_', ' ')}</Badge>;
    };

    useEffect(() => {
        nodeApi.get<any>('/bookings/my')
            .then(r => setBookings(r?.bookings ?? r?.data?.bookings ?? []))
            .catch(() => setError(t('dashboard.loadError')))
            .finally(() => setLoading(false));
    }, []);

    const activeList    = bookings.filter(b => isActive(b) || isUpcoming(b));
    const historyList   = bookings.filter(b => !isActive(b) && !isUpcoming(b));
    const totalSpent    = bookings.filter(isCompleted).reduce((s, b) => s + Number(b.total_amount), 0);
    const upcomingCount = bookings.filter(isUpcoming).length;

    const stats = [
        { label: t('dashboard.activeBookings'), value: String(activeList.length),  icon: Package,      changeType: 'neutral' as const },
        { label: t('dashboard.totalRentals'),   value: String(bookings.length),     icon: TrendingUp,   changeType: 'positive' as const },
        { label: t('dashboard.totalSpent'),     value: fmtAmount(totalSpent),       icon: IndianRupee,  changeType: 'neutral' as const },
        { label: t('dashboard.upcoming'),       value: String(upcomingCount),       icon: Calendar,     changeType: 'neutral' as const },
    ];

    return (
        <div className="py-8 lg:py-12 min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 lg:px-8">
                <div className="mb-8 flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold mb-2">{t('dashboard.title')}</h1>
                        <p className="text-gray-500">
                            {user?.name ? t('dashboard.welcome', { name: user.name }) : t('dashboard.welcomeGeneric')}{' '}
                            {t('dashboard.overview')}
                        </p>
                    </div>
                    <Link href="/add-equipment">
                        <Button size="lg" className="gap-2 bg-green-700 hover:bg-green-800">
                            <Plus className="h-5 w-5" />
                            <span className="hidden sm:inline">{t('dashboard.addEquipment')}</span>
                            <span className="sm:hidden">{t('dashboard.add')}</span>
                        </Button>
                    </Link>
                </div>

                {/* Error banner */}
                {error && (
                    <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                        <AlertCircle className="h-5 w-5 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    {stats.map((stat) => (
                        <Card key={stat.label}>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="bg-green-100 rounded-lg p-3">
                                        <stat.icon className="h-6 w-6 text-green-700" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm text-gray-500">{stat.label}</p>
                                    {loading
                                        ? <Skeleton className="h-9 w-20" />
                                        : <p className="text-3xl font-bold">{stat.value}</p>
                                    }
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Bookings */}
                <Card>
                    <CardHeader>
                        <CardTitle>{t('dashboard.myBookings')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Tabs defaultValue="active" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 mb-6">
                                <TabsTrigger value="active">
                                    {t('dashboard.activeAndUpcoming')}{!loading && ` (${activeList.length})`}
                                </TabsTrigger>
                                <TabsTrigger value="history">
                                    {t('dashboard.history')}{!loading && ` (${historyList.length})`}
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="active" className="space-y-4">
                                {loading
                                    ? [1, 2].map(i => <BookingCardSkeleton key={i} />)
                                    : activeList.length === 0
                                    ? <EmptyBookings variant="active" />
                                    : activeList.map(booking => (
                                        <Card key={booking.id} className="border-2">
                                            <CardContent className="p-6">
                                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                                    <div className="flex items-start gap-4 flex-1">
                                                        {getStatusIcon(booking.status)}
                                                        <div className="flex-1">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <h3 className="font-semibold text-lg">
                                                                    {booking.equipment?.name ?? 'Equipment'}
                                                                </h3>
                                                                {getStatusBadge(booking.status)}
                                                            </div>
                                                            <p className="text-sm text-gray-500 mb-2">
                                                                {t('dashboard.type')}: {booking.equipment?.type?.replace(/-/g, ' ') ?? '—'}
                                                            </p>
                                                            <div className="flex flex-wrap gap-4 text-sm">
                                                                <div className="flex items-center gap-1">
                                                                    <Calendar className="h-4 w-4 text-gray-400" />
                                                                    <span>{fmt(booking.start_date)} – {fmt(booking.end_date)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1">
                                                                    <IndianRupee className="h-4 w-4 text-gray-400" />
                                                                    <span className="font-semibold">{fmtAmount(booking.total_amount)}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <Link href={`/equipment/${booking.equipment_id}`}>
                                                        <Button variant="outline" size="sm">
                                                            <ExternalLink className="h-4 w-4 mr-2" />{t('dashboard.viewDetails')}
                                                        </Button>
                                                    </Link>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))
                                }
                            </TabsContent>

                            <TabsContent value="history" className="space-y-4">
                                {loading
                                    ? [1, 2].map(i => <BookingCardSkeleton key={i} />)
                                    : historyList.length === 0
                                    ? <EmptyBookings variant="past" />
                                    : historyList.map(booking => (
                                        <Card key={booking.id}>
                                            <CardContent className="p-6">
                                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                                                    <div className="flex items-start gap-4 flex-1">
                                                        {getStatusIcon(booking.status)}
                                                        <div className="flex-1">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <h3 className="font-semibold text-lg">
                                                                    {booking.equipment?.name ?? 'Equipment'}
                                                                </h3>
                                                                {getStatusBadge(booking.status)}
                                                            </div>
                                                            <p className="text-sm text-gray-500 mb-2">
                                                                {t('dashboard.type')}: {booking.equipment?.type?.replace(/-/g, ' ') ?? '—'}
                                                            </p>
                                                            <div className="flex flex-wrap gap-4 text-sm">
                                                                <div className="flex items-center gap-1">
                                                                    <Calendar className="h-4 w-4 text-gray-400" />
                                                                    <span>{fmt(booking.start_date)} – {fmt(booking.end_date)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1">
                                                                    <IndianRupee className="h-4 w-4 text-gray-400" />
                                                                    <span className="font-semibold">{fmtAmount(booking.total_amount)}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Link href={`/equipment/${booking.equipment_id}`}>
                                                            <Button variant="outline" size="sm">{t('dashboard.viewEquipment')}</Button>
                                                        </Link>
                                                        <Link href={`/browse?q=${encodeURIComponent(booking.equipment?.name ?? '')}`}>
                                                            <Button variant="outline" size="sm">{t('dashboard.rentAgain')}</Button>
                                                        </Link>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))
                                }
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
