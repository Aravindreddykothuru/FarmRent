'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useDriverGPS }    from '@/hooks/useDriverGPS';
import BookingStatusBar    from '@/components/BookingStatusBar';
import { nodeApi }         from '@/lib/api';
import {
    Truck, Power, PowerOff, CheckCircle2, Play, Flag,
    Navigation, AlertCircle, Star, IndianRupee, Loader2, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';

interface Booking {
    id: string;
    status: string;
    farmer_name?: string;
    start_date: string;
    end_date: string;
    total_amount: number;
    pickup_lat?: number;
    pickup_lng?: number;
    eta_minutes?: number;
    distance_km?: number;
    equipment?: { name: string; type: string };
    'users!renter_id'?: { name?: string; phone?: string };
}

interface DriverProfile {
    id: string;
    vehicle_name: string;
    vehicle_type: string;
    vehicle_number: string;
    is_available: boolean;
    rating: number;
    total_trips: number;
    users?: { name?: string };
}

export default function DriverDashboard() {
    const router = useRouter();
    const { t } = useLanguage();
    const [driverProfile, setDriver]    = useState<DriverProfile | null>(null);
    const [bookings, setBookings]       = useState<Booking[]>([]);
    const [loading, setLoading]         = useState(true);
    const [online, setOnline]           = useState(false);
    const [togglingOnline, setToggling] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [_userId, setUserId]           = useState<string | null>(null);

    // Active booking = first in_progress or accepted
    const activeBooking = bookings.find(b => ['accepted', 'in_progress'].includes(b.status)) || null;

    // Driver GPS hook — only transmits when online and has an active booking
    const { position, error: gpsError, isTransmitting } = useDriverGPS(
        driverProfile?.id ?? null,
        activeBooking?.id ?? null,
        online
    );

    // Load driver profile + user
    useEffect(() => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (token) {
            try {
                const p = JSON.parse(atob(token.split('.')[1]));
                setUserId(p.sub || p.id);
            } catch { /* */ }
        }

        nodeApi.get<{ success: boolean; data: DriverProfile }>('/drivers/me')
            .then(r => {
                setDriver(r.data);
                setOnline(r.data.is_available);
            })
            .catch(() => {
                // Not a driver yet — redirect to register
                router.replace('/dashboard/driver/register');
            })
            .finally(() => setLoading(false));
    }, [router]);

    // Load driver's bookings
    const loadBookings = useCallback(() => {
        nodeApi.get<{ bookings: Booking[] }>('/bookings/driver')
            .then(r => setBookings(r.bookings || []))
            .catch(() => setBookings([]));
    }, []);

    useEffect(() => {
        if (!driverProfile) return;
        loadBookings();
        const id = setInterval(loadBookings, 15000); // refresh every 15s
        return () => clearInterval(id);
    }, [driverProfile, loadBookings]);

    // Toggle online/offline
    const toggleOnline = async () => {
        setToggling(true);
        try {
            await nodeApi.patch('/drivers/availability', { is_available: !online });
            setOnline(v => !v);
            toast.success(!online ? t('driver.nowOnline') : t('driver.nowOffline'));
        } catch {
            toast.error(t('driver.failedUpdateAvailability'));
        } finally {
            setToggling(false);
        }
    };

    // Accept booking
    const handleAccept = async (bookingId: string) => {
        setActionLoading(bookingId + '_accept');
        try {
            await nodeApi.patch(`/bookings/${bookingId}/accept`, {});
            toast.success(t('driver.bookingAccepted'));
            loadBookings();
        } catch { toast.error(t('driver.failedAccept')); }
        finally { setActionLoading(null); }
    };

    // Start trip
    const handleStart = async (bookingId: string) => {
        setActionLoading(bookingId + '_start');
        try {
            await nodeApi.patch(`/bookings/${bookingId}/start`, {});
            toast.success(t('driver.tripStarted'));
            loadBookings();
        } catch { toast.error(t('driver.failedStart')); }
        finally { setActionLoading(null); }
    };

    // Complete trip
    const handleComplete = async (bookingId: string) => {
        setActionLoading(bookingId + '_complete');
        try {
            await nodeApi.patch(`/bookings/${bookingId}/complete`, {});
            toast.success(t('driver.tripCompleted'));
            loadBookings();
        } catch { toast.error(t('driver.failedComplete')); }
        finally { setActionLoading(null); }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <Loader2 className="w-10 h-10 animate-spin text-green-600" />
        </div>
    );

    const pending     = bookings.filter(b => b.status === 'requested');
    const completed   = bookings.filter(b => b.status === 'completed');
    const earnings    = completed.reduce((s, b) => s + (b.total_amount || 0), 0);

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b sticky top-0 z-50">
                <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                            <Truck className="w-5 h-5 text-green-700" />
                        </div>
                        <div>
                            <p className="font-bold text-gray-900">{driverProfile?.users?.name || 'Driver'}</p>
                            <p className="text-xs text-gray-500">{driverProfile?.vehicle_name} · {driverProfile?.vehicle_number}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        suppressHydrationWarning
                        onClick={toggleOnline}
                        disabled={togglingOnline}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                            online
                                ? 'bg-green-600 text-white hover:bg-green-700'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}>
                        {togglingOnline ? <Loader2 className="w-4 h-4 animate-spin" /> :
                            online ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                        {online ? t('driver.online') : t('driver.offline')}
                    </button>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">

                {/* GPS Transmit status */}
                {online && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl text-sm font-medium ${
                        isTransmitting ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                        <Navigation className={`w-4 h-4 ${isTransmitting ? 'animate-pulse' : ''}`} />
                        {gpsError
                            ? t('driver.gpsError', { error: gpsError })
                            : isTransmitting
                                ? `${t('driver.transmitting')}${position ? ` · ${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}` : ''}`
                                : t('driver.acquiringGPS')}
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: t('driver.rating'), value: driverProfile?.rating?.toFixed(1) ?? '5.0', icon: Star, color: 'text-amber-600 bg-amber-50' },
                        { label: t('driver.totalTrips'), value: driverProfile?.total_trips ?? 0, icon: CheckCircle2, color: 'text-green-700 bg-green-50' },
                        { label: t('driver.earnings'), value: `₹${earnings.toLocaleString('en-IN')}`, icon: IndianRupee, color: 'text-blue-700 bg-blue-50' },
                    ].map(s => (
                        <div key={s.label} className="bg-white rounded-2xl shadow-sm border p-3 text-center">
                            <div className={`inline-flex p-2 rounded-full mb-1 ${s.color}`}>
                                <s.icon className="w-4 h-4" />
                            </div>
                            <p className="font-bold text-gray-900">{s.value}</p>
                            <p className="text-xs text-gray-500">{s.label}</p>
                        </div>
                    ))}
                </div>

                {/* Active Trip */}
                {activeBooking && (
                    <div className="bg-white rounded-2xl shadow-md border-2 border-green-400 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-bold text-gray-900 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                {t('driver.activeTrip')}
                            </h2>
                            <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-1 rounded-full">
                                {activeBooking.status.replace('_', ' ').toUpperCase()}
                            </span>
                        </div>

                        <BookingStatusBar status={activeBooking.status} />

                        <div className="space-y-1 text-sm text-gray-700">
                            <p><span className="text-gray-400">{t('driver.equipment')}:</span> <strong>{activeBooking.equipment?.name}</strong></p>
                            <p><span className="text-gray-400">{t('driver.farmer')}:</span> {activeBooking.farmer_name || activeBooking['users!renter_id']?.name}</p>
                            <p><span className="text-gray-400">{t('driver.dates')}:</span> {activeBooking.start_date} → {activeBooking.end_date}</p>
                            {activeBooking.distance_km && <p><span className="text-gray-400">{t('driver.distance')}:</span> {activeBooking.distance_km} km</p>}
                            <p><span className="text-gray-400">{t('driver.amount')}:</span> <strong className="text-green-700">₹{activeBooking.total_amount?.toLocaleString('en-IN')}</strong></p>
                        </div>

                        <div className="flex gap-2 pt-1">
                            {activeBooking.status === 'accepted' && (
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={() => handleStart(activeBooking.id)}
                                    disabled={!!actionLoading}
                                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-semibold transition-colors">
                                    {actionLoading === activeBooking.id + '_start'
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Play className="w-4 h-4" />}
                                    {t('driver.startTrip')}
                                </button>
                            )}
                            {activeBooking.status === 'in_progress' && (
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={() => handleComplete(activeBooking.id)}
                                    disabled={!!actionLoading}
                                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold transition-colors">
                                    {actionLoading === activeBooking.id + '_complete'
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <Flag className="w-4 h-4" />}
                                    {t('driver.completeTrip')}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Pending Requests */}
                {pending.length > 0 && (
                    <div className="space-y-3">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-500" />
                            {t('driver.newRequests')} ({pending.length})
                        </h2>
                        {pending.map(b => (
                            <div key={b.id} className="bg-white rounded-2xl shadow-sm border p-4 space-y-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-semibold text-gray-900">{b.equipment?.name}</p>
                                        <p className="text-sm text-gray-500">{b.farmer_name} · {b.start_date} → {b.end_date}</p>
                                    </div>
                                    <span className="font-bold text-green-700 text-sm">₹{b.total_amount?.toLocaleString('en-IN')}</span>
                                </div>
                                {(b.distance_km || b.eta_minutes) && (
                                    <div className="flex gap-2 text-xs text-gray-500">
                                        {b.distance_km && <span>📍 {t('driver.awayKm', { km: String(b.distance_km) })}</span>}
                                        {b.eta_minutes && <span>⏱ {t('driver.etaMin', { min: String(b.eta_minutes) })}</span>}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={() => handleAccept(b.id)}
                                        disabled={!!actionLoading}
                                        className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-medium text-sm transition-colors">
                                        {actionLoading === b.id + '_accept'
                                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : <CheckCircle2 className="w-3.5 h-3.5" />}
                                        {t('driver.accept')}
                                    </button>
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={async () => {
                                            await nodeApi.patch(`/bookings/${b.id}/cancel`, {});
                                            loadBookings();
                                        }}
                                        className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors">
                                        {t('driver.decline')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* No active work */}
                {!activeBooking && pending.length === 0 && (
                    <div className="text-center py-12 bg-white rounded-2xl shadow-sm border">
                        <Truck className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                        <p className="font-medium text-gray-600">
                            {online ? t('driver.noRequestsOnline') : t('driver.offlineMessage')}
                        </p>
                    </div>
                )}

                {/* Trip history */}
                {completed.length > 0 && (
                    <div className="space-y-2">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-gray-400" />
                            {t('driver.recentTrips')}
                        </h2>
                        {completed.slice(0, 5).map(b => (
                            <div key={b.id} className="bg-white rounded-xl border px-4 py-3 flex justify-between items-center">
                                <div>
                                    <p className="font-medium text-sm text-gray-800">{b.equipment?.name}</p>
                                    <p className="text-xs text-gray-500">{b.start_date}</p>
                                </div>
                                <span className="font-bold text-green-700">₹{b.total_amount?.toLocaleString('en-IN')}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
