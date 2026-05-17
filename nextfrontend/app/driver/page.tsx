'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    MapPin, Navigation, CheckCircle2,
    AlertTriangle, Truck, Star, User,
    Play, Square, Share2, RefreshCw, ChevronRight
} from 'lucide-react';
import { useDriverGPS, type GPSQuality } from '@/hooks/useDriverGPS';
import { nodeApi } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverProfile {
    id:               string;
    user_id:          string;
    vehicle_name:     string;
    vehicle_type:     string;
    vehicle_number:   string;
    is_available:     boolean;
    location_sharing: boolean;
    current_lat?:     number;
    current_lng?:     number;
    rating?:          number;
    total_trips?:     number;
    users?:           { name?: string; phone?: string; email?: string };
}

interface ActiveBooking {
    id:           string;
    status:       string;
    farmer_name:  string;
    total_amount: number;
    pickup_lat?:  number;
    pickup_lng?:  number;
    equipment?:   { name: string; type: string };
    renter_id?:   string;
}

// ── Signal quality display ────────────────────────────────────────────────────

const QUALITY_CONFIG: Record<GPSQuality, { cls: string; label: string; icon: string }> = {
    excellent: { cls: 'bg-green-100 text-green-700',   label: 'Excellent GPS', icon: '📶' },
    good:      { cls: 'bg-blue-100 text-blue-700',     label: 'Good GPS',      icon: '📶' },
    poor:      { cls: 'bg-yellow-100 text-yellow-700', label: 'Weak GPS',      icon: '📶' },
    none:      { cls: 'bg-red-100 text-red-600',       label: 'No GPS',        icon: '📵' },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function DriverDashboard() {
    const router = useRouter();

    const [driver,        setDriver]        = useState<DriverProfile | null>(null);
    const [bookings,      setBookings]      = useState<ActiveBooking[]>([]);
    const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
    const [loading,       setLoading]       = useState(true);
    const [isOnline,      setIsOnline]      = useState(false);
    const [shareLocation, setShareLocation] = useState(true);
    const [tripStarted,   setTripStarted]   = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error,         setError]         = useState<string | null>(null);
    const [lastAction,    setLastAction]    = useState<string | null>(null);

    const gpsEnabled = isOnline && shareLocation;

    const {
        position, error: gpsError, isTransmitting,
        isConnected, quality, lastSentAt,
    } = useDriverGPS(
        driver?.id ?? null,
        activeBooking?.id ?? null,
        gpsEnabled
    );

    // ── Load driver profile ───────────────────────────────────────────────────
    const loadProfile = useCallback(async () => {
        try {
            const r = await nodeApi.get<{ success: boolean; data: DriverProfile }>('/drivers/me');
            setDriver(r.data);
            setIsOnline(r.data.is_available);
            setShareLocation(r.data.location_sharing ?? true);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to load profile';
            if (msg.includes('404') || msg.includes('not found')) {
                setError('Driver profile not found. Please register as a driver first.');
            } else {
                setError(msg);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Load assigned bookings ────────────────────────────────────────────────
    const loadBookings = useCallback(async () => {
        try {
            const r = await nodeApi.get<{ bookings: ActiveBooking[] }>('/bookings/driver');
            const all = r.bookings ?? [];
            setBookings(all);
            const active = all.find(b => ['accepted', 'in_progress'].includes(b.status));
            setActiveBooking(active ?? null);
            setTripStarted(active?.status === 'in_progress');
        } catch { /* non-critical poll */ }
    }, []);

    useEffect(() => {
        loadProfile();
        loadBookings();
        const interval = setInterval(loadBookings, 30_000);
        return () => clearInterval(interval);
    }, [loadProfile, loadBookings]);

    // Auto-dismiss the last-action toast after 3 seconds
    useEffect(() => {
        if (!lastAction) return;
        const t = setTimeout(() => setLastAction(null), 3000);
        return () => clearTimeout(t);
    }, [lastAction]);

    // ── Go Online / Offline ───────────────────────────────────────────────────
    const toggleOnline = useCallback(async () => {
        if (!driver) return;
        setActionLoading('online');
        try {
            await nodeApi.patch('/drivers/availability', { is_available: !isOnline });
            setIsOnline(prev => !prev);
            setLastAction(isOnline ? 'Went offline' : 'Now online');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to update status');
        } finally {
            setActionLoading(null);
        }
    }, [driver, isOnline]);

    // ── Toggle location sharing ───────────────────────────────────────────────
    const toggleSharing = useCallback(async () => {
        setActionLoading('share');
        try {
            await nodeApi.patch('/drivers/share-location', { sharing: !shareLocation });
            setShareLocation(prev => !prev);
            setLastAction(!shareLocation ? 'Location sharing on' : 'Location sharing off');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to toggle sharing');
        } finally {
            setActionLoading(null);
        }
    }, [shareLocation]);

    // ── Start Trip ────────────────────────────────────────────────────────────
    const startTrip = useCallback(async () => {
        if (!activeBooking) return;
        setActionLoading('trip_start');
        try {
            await nodeApi.post('/drivers/trip/start', { booking_id: activeBooking.id });
            setTripStarted(true);
            setActiveBooking(prev => prev ? { ...prev, status: 'in_progress' } : prev);
            setLastAction('Trip started!');
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to start trip');
        } finally {
            setActionLoading(null);
        }
    }, [activeBooking]);

    // ── End Trip ──────────────────────────────────────────────────────────────
    const endTrip = useCallback(async () => {
        if (!activeBooking) return;
        setActionLoading('trip_end');
        try {
            await nodeApi.post('/drivers/trip/end', { booking_id: activeBooking.id });
            setTripStarted(false);
            setActiveBooking(null);
            setLastAction('Trip completed! ✅');
            await loadBookings();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to end trip');
        } finally {
            setActionLoading(null);
        }
    }, [activeBooking, loadBookings]);

    // ─────────────────────────────────────────────────────────────────────────

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800">
            <div className="text-center text-white">
                <div className="text-5xl mb-4 animate-bounce">🚜</div>
                <p className="text-slate-400 text-sm">Loading driver dashboard…</p>
            </div>
        </div>
    );

    if (error && !driver) return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
            <div className="text-center max-w-sm">
                <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
                <p className="text-white font-semibold mb-2">Driver Setup Required</p>
                <p className="text-slate-400 text-sm mb-6">{error}</p>
                <button
                    type="button"
                    suppressHydrationWarning
                    onClick={() => router.push('/dashboard')}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-medium transition-colors"
                >
                    Go to Dashboard
                </button>
            </div>
        </div>
    );

    const qConfig = QUALITY_CONFIG[quality];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">

            {/* Header */}
            <div className="px-4 pt-6 pb-4">
                <div className="flex items-center justify-between mb-1">
                    <h1 className="text-xl font-bold">Driver Dashboard</h1>
                    <button
                        type="button"
                        suppressHydrationWarning
                        onClick={loadBookings}
                        aria-label="Refresh bookings"
                        className="p-2 rounded-full hover:bg-slate-700 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4 text-slate-400" />
                    </button>
                </div>
                <p className="text-slate-400 text-sm">
                    {driver?.users?.name ?? 'Driver'} · {driver?.vehicle_number}
                </p>
            </div>

            <div className="px-4 space-y-4 pb-24">

                {/* ── Online / Offline toggle ──────────────────────────────── */}
                <div className={`rounded-2xl p-5 transition-all duration-300 ${
                    isOnline
                        ? 'bg-gradient-to-br from-green-600/30 to-emerald-600/20 border border-green-500/30'
                        : 'bg-slate-800 border border-slate-700'
                }`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                                <span className="font-semibold text-lg">
                                    {isOnline ? 'Online' : 'Offline'}
                                </span>
                            </div>
                            <p className="text-slate-400 text-sm">
                                {isOnline
                                    ? 'You are visible to farmers and can receive bookings'
                                    : 'Go online to start receiving bookings'}
                            </p>
                        </div>
                        <button
                            type="button"
                            suppressHydrationWarning
                            aria-label={isOnline ? 'Go offline' : 'Go online'}
                            onClick={toggleOnline}
                            disabled={actionLoading === 'online'}
                            className={`w-16 h-8 rounded-full transition-all duration-300 relative flex-shrink-0 ${
                                isOnline ? 'bg-green-500' : 'bg-slate-600'
                            } ${actionLoading === 'online' ? 'opacity-50' : ''}`}
                        >
                            <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all duration-300 ${
                                isOnline ? 'left-9' : 'left-1'
                            }`} />
                        </button>
                    </div>
                </div>

                {/* ── GPS Status ────────────────────────────────────────────── */}
                {isOnline && (
                    <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold text-sm text-slate-300 uppercase tracking-wider">GPS Signal</h3>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${qConfig.cls}`}>
                                {qConfig.icon} {qConfig.label}
                            </span>
                        </div>

                        {position ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-slate-700/50 rounded-xl p-3">
                                    <p className="text-xs text-slate-400 mb-1">Speed</p>
                                    <p className="font-bold text-lg">{position.speed.toFixed(1)} <span className="text-sm font-normal text-slate-400">km/h</span></p>
                                </div>
                                <div className="bg-slate-700/50 rounded-xl p-3">
                                    <p className="text-xs text-slate-400 mb-1">Accuracy</p>
                                    <p className="font-bold text-lg">±{position.accuracy.toFixed(0)} <span className="text-sm font-normal text-slate-400">m</span></p>
                                </div>
                                <div className="bg-slate-700/50 rounded-xl p-3">
                                    <p className="text-xs text-slate-400 mb-1">Latitude</p>
                                    <p className="font-mono text-sm">{position.smoothedLat.toFixed(5)}</p>
                                </div>
                                <div className="bg-slate-700/50 rounded-xl p-3">
                                    <p className="text-xs text-slate-400 mb-1">Longitude</p>
                                    <p className="font-mono text-sm">{position.smoothedLng.toFixed(5)}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 text-slate-400 text-sm py-2">
                                <MapPin className="w-4 h-4 animate-pulse" />
                                {gpsError ?? 'Acquiring GPS signal…'}
                            </div>
                        )}

                        {/* Transmission status */}
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                isConnected && isTransmitting
                                    ? 'bg-green-400 animate-pulse'
                                    : isConnected ? 'bg-amber-400' : 'bg-red-400'
                            }`} />
                            <span className="text-xs text-slate-400">
                                {isConnected && isTransmitting
                                    ? `Transmitting live · Last sent ${lastSentAt ? new Date(lastSentAt).toLocaleTimeString() : '—'}`
                                    : isConnected ? 'Connected, waiting for GPS…'
                                    : 'Socket disconnected — using REST fallback'}
                            </span>
                        </div>
                    </div>
                )}

                {/* ── Share Location toggle ─────────────────────────────────── */}
                {isOnline && (
                    <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`p-2.5 rounded-xl ${shareLocation ? 'bg-blue-600/20' : 'bg-slate-700'}`}>
                                <Share2 className={`w-5 h-5 ${shareLocation ? 'text-blue-400' : 'text-slate-400'}`} />
                            </div>
                            <div>
                                <p className="font-medium text-sm">Share Live Location</p>
                                <p className="text-xs text-slate-400">
                                    {shareLocation ? 'Farmers can see your real-time position' : 'Location hidden from farmers'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            suppressHydrationWarning
                            aria-label={shareLocation ? 'Stop sharing location' : 'Share location'}
                            onClick={toggleSharing}
                            disabled={actionLoading === 'share'}
                            className={`w-12 h-6 rounded-full transition-all relative flex-shrink-0 ${
                                shareLocation ? 'bg-blue-500' : 'bg-slate-600'
                            } ${actionLoading === 'share' ? 'opacity-50' : ''}`}
                        >
                            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                                shareLocation ? 'left-6' : 'left-0.5'
                            }`} />
                        </button>
                    </div>
                )}

                {/* ── Active Booking panel ──────────────────────────────────── */}
                {activeBooking && (
                    <div className="bg-gradient-to-br from-green-900/40 to-emerald-900/30 rounded-2xl p-4 border border-green-500/30">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                            <h3 className="font-semibold text-green-300 text-sm uppercase tracking-wider">Active Booking</h3>
                        </div>

                        <div className="space-y-2 mb-4">
                            <div className="flex items-center gap-2">
                                <Truck className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <span className="text-sm">{activeBooking.equipment?.name ?? 'Equipment'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <span className="text-sm text-slate-300">{activeBooking.farmer_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 uppercase">
                                    {activeBooking.status.replace(/_/g, ' ')}
                                </span>
                            </div>
                        </div>

                        {/* Trip controls */}
                        <div className="grid grid-cols-2 gap-3">
                            {!tripStarted ? (
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={startTrip}
                                    disabled={!!actionLoading}
                                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors col-span-2"
                                >
                                    {actionLoading === 'trip_start'
                                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                                        : <Play className="w-4 h-4" />}
                                    Start Trip
                                </button>
                            ) : (
                                <>
                                    <div className="flex items-center justify-center gap-2 bg-green-800/40 text-green-400 font-medium py-3 rounded-xl text-sm">
                                        <Navigation className="w-4 h-4 animate-pulse" />
                                        In Progress
                                    </div>
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={endTrip}
                                        disabled={!!actionLoading}
                                        className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
                                    >
                                        {actionLoading === 'trip_end'
                                            ? <RefreshCw className="w-4 h-4 animate-spin" />
                                            : <Square className="w-4 h-4" />}
                                        End Trip
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Assigned bookings list ────────────────────────────────── */}
                {bookings.filter(b => !['completed', 'cancelled'].includes(b.status)).length > 0 && (
                    <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
                        <h3 className="font-semibold text-sm text-slate-300 uppercase tracking-wider mb-3">
                            Assigned Bookings
                        </h3>
                        <div className="space-y-2">
                            {bookings
                                .filter(b => !['completed', 'cancelled'].includes(b.status))
                                .map(b => (
                                <button
                                    key={b.id}
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={() => router.push(`/tracking/${b.id}`)}
                                    className="w-full flex items-center justify-between p-3 bg-slate-700/50 rounded-xl hover:bg-slate-700 transition-colors text-left"
                                >
                                    <span className="block">
                                        <span className="block font-medium text-sm">{b.equipment?.name ?? 'Equipment'}</span>
                                        <span className="block text-xs text-slate-400">{b.farmer_name}</span>
                                        <span className="text-xs font-medium mt-1 inline-block px-2 py-0.5 rounded-full bg-slate-600 text-slate-300 uppercase">
                                            {b.status.replace(/_/g, ' ')}
                                        </span>
                                    </span>
                                    <span className="flex items-center gap-1 text-slate-400 flex-shrink-0">
                                        <span className="text-xs">₹{b.total_amount?.toLocaleString('en-IN')}</span>
                                        <ChevronRight className="w-4 h-4" />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Driver stats ──────────────────────────────────────────── */}
                {driver && (
                    <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
                        <h3 className="font-semibold text-sm text-slate-300 uppercase tracking-wider mb-3">Your Stats</h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                                    <span className="font-bold">{(driver.rating ?? 5.0).toFixed(1)}</span>
                                </div>
                                <p className="text-xs text-slate-400">Rating</p>
                            </div>
                            <div className="text-center">
                                <div className="font-bold mb-1">{driver.total_trips ?? 0}</div>
                                <p className="text-xs text-slate-400">Trips</p>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                                </div>
                                <p className="text-xs text-slate-400">Verified</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Last action feedback ──────────────────────────────────── */}
                {lastAction && (
                    <div className="fixed bottom-6 left-4 right-4 bg-slate-700 text-white text-sm font-medium py-3 px-4 rounded-xl shadow-xl flex items-center gap-2 z-50">
                        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                        {lastAction}
                    </div>
                )}

                {/* ── Error message ─────────────────────────────────────────── */}
                {error && (
                    <div className="bg-red-900/30 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-red-300 text-sm font-medium">Error</p>
                            <p className="text-red-400 text-xs mt-0.5">{error}</p>
                        </div>
                        <button
                            type="button"
                            suppressHydrationWarning
                            aria-label="Dismiss error"
                            onClick={() => setError(null)}
                            className="ml-auto text-red-400 hover:text-red-300"
                        >×</button>
                    </div>
                )}

            </div>
        </div>
    );
}
