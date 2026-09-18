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
    // Completion code the renter reads out at the end of the trip
    const [showTripOtp, setShowTripOtp]  = useState(false);
    const [tripOtp, setTripOtp]          = useState('');

    // Active booking = the first the owner has confirmed, or one already under way.
    // These are the status names the API returns (booking-service/lifecycle.js maps them for the client).
    const activeBooking = bookings.find(b => ['confirmed', 'in_progress'].includes(b.status)) || null;

    // Driver GPS hook — only transmits when online and has an active booking
    const { position, error: gpsError, isTransmitting } = useDriverGPS(
        driverProfile?.id ?? null,
        activeBooking?.id ?? null,
        online
    );

    // Load driver profile + user
    useEffect(() => {
        // The API client unwraps the envelope: this is the profile itself, or null for non-drivers.
        nodeApi.get<DriverProfile | null>('/drivers/me')
            .then(profile => {
                if (!profile) {
                    router.replace('/dashboard/driver/register');
                    return;
                }
                setDriver(profile);
                setOnline(profile.is_available);
            })
            .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not load your driver profile'))
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

    // Start the trip. Drivers move the rental through the same lifecycle as the owner, on their own endpoint.
    const handleStart = async (bookingId: string) => {
        setActionLoading(bookingId + '_start');
        try {
            await nodeApi.post('/drivers/trip/start', { booking_id: bookingId });
            toast.success(t('driver.tripStarted'));
            loadBookings();
        } catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('driver.failedStart')); }
        finally { setActionLoading(null); }
    };

    // Complete trip — like the owner, the driver needs the code shown on the renter's booking page
    const handleComplete = async (bookingId: string) => {
        if (!/^\d{6}$/.test(tripOtp)) {
            toast.error("Enter the 6-digit completion code from the renter's booking page");
            return;
        }
        setActionLoading(bookingId + '_complete');
        try {
            await nodeApi.post('/drivers/trip/end', { booking_id: bookingId, otp: tripOtp });
            toast.success(t('driver.tripCompleted'));
            setShowTripOtp(false);
            setTripOtp('');
            loadBookings();
        } catch (e: unknown) { toast.error(e instanceof Error ? e.message : t('driver.failedComplete')); }
        finally { setActionLoading(null); }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <Loader2 className="w-10 h-10 animate-spin text-green-600" />
        </div>
    );

    // Assigned to this driver but not yet confirmed by the owner — the driver cannot act on these yet.
    const pending     = bookings.filter(b => b.status === 'pending');
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
                            {activeBooking.status === 'confirmed' && (
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
                            {activeBooking.status === 'in_progress' && !showTripOtp && (
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={() => setShowTripOtp(true)}
                                    disabled={!!actionLoading}
                                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold transition-colors">
                                    <Flag className="w-4 h-4" />
                                    {t('driver.completeTrip')}
                                </button>
                            )}
                        </div>

                        {activeBooking.status === 'in_progress' && showTripOtp && (
                            <div className="space-y-3 border-t pt-3">
                                <p className="text-sm font-bold text-gray-800">Enter the renter&apos;s completion code</p>
                                <p className="text-xs text-gray-500">Ask the farmer for the 6-digit code shown on their booking page.</p>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    aria-label="Completion code"
                                    placeholder="6-digit code"
                                    value={tripOtp}
                                    maxLength={6}
                                    suppressHydrationWarning
                                    onChange={e => setTripOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-2xl font-mono font-black tracking-[0.75rem] focus:outline-none focus:border-green-500"
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={() => { setShowTripOtp(false); setTripOtp(''); }}
                                        className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl font-medium text-sm hover:bg-gray-50 transition-colors">
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={() => handleComplete(activeBooking.id)}
                                        disabled={tripOtp.length !== 6 || !!actionLoading}
                                        className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
                                        {actionLoading === activeBooking.id + '_complete'
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : <Flag className="w-4 h-4" />}
                                        Confirm complete
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Pending Requests */}
                {pending.length > 0 && (
                    <div className="space-y-3">
                        <h2 className="font-bold text-gray-800 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-amber-500" />
                            Assigned to you ({pending.length})
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
                                {/* A driver cannot accept or decline: only the owner confirms a rental request. */}
                                <p className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                                    <Clock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                    Waiting for the owner to confirm. You can start this trip once they do.
                                </p>
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
