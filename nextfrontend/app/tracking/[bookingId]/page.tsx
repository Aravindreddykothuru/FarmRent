'use client';

/**
 * /tracking/[bookingId]/page.tsx — Production farmer live-tracking page
 *
 * Upgrades over v1:
 *  • Real-time ETA recalculation on every driver GPS update (haversine + OSRM via socket)
 *  • Live route geometry refresh (pushed from server after OSRM recalc)
 *  • Booking status sync via socket (no polling)
 *  • Connection state banner (connected / reconnecting / offline)
 *  • Trip history link (replay)
 *  • Cancel with optimistic UI
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import BookingStatusBar from '@/components/BookingStatusBar';
import DriverInfoCard   from '@/components/DriverInfoCard';
import TrackingMap      from '@/components/TrackingMap';
import { useBookingSocket } from '@/hooks/useBookingSocket';
import { nodeApi } from '@/lib/api';
import { ArrowLeft, AlertCircle, MapPin, RotateCcw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BookingData {
    id:             string;
    status:         string;
    farmer_name:    string;
    total_amount:   number;
    start_date:     string;
    end_date:       string;
    pickup_lat?:    number;
    pickup_lng?:    number;
    dropoff_lat?:   number;
    dropoff_lng?:   number;
    distance_km?:   number;
    eta_minutes?:   number;
    route_geometry?: string;
    equipment?:     { name: string; type: string; images?: string[] };
    drivers?: {
        id:            string;
        vehicle_name:  string;
        vehicle_type:  string;
        vehicle_number: string;
        rating:        number;
        total_trips:   number;
        users?:        { name?: string; phone?: string };
    };
}

// ── Haversine ETA estimate ────────────────────────────────────────────────────

function haversineEta(
    driverLat: number, driverLng: number,
    pickupLat: number, pickupLng: number,
    speedKmh   = 40
): number {
    const R = 6371;
    const dLat = ((pickupLat - driverLat) * Math.PI) / 180;
    const dLng = ((pickupLng - driverLng) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((driverLat * Math.PI) / 180) *
        Math.cos((pickupLat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.max(1, Math.ceil((distKm / speedKmh) * 60));
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LiveTrackingPage() {
    const params    = useParams();
    const router    = useRouter();
    const bookingId = params?.bookingId as string;

    const [booking,      setBooking]    = useState<BookingData | null>(null);
    const [loading,      setLoading]    = useState(true);
    const [liveEta,      setLiveEta]    = useState<number | null>(null);
    const [liveDistKm,   setLiveDistKm] = useState<number | null>(null);
    const [liveRoute,    setLiveRoute]  = useState<unknown>(null);
    const [cancelling,   setCancelling] = useState(false);

    const {
        location,
        status:        liveStatus,
        routeUpdate,
        isConnected,
        connectionState,
    } = useBookingSocket(bookingId, booking?.pickup_lat, booking?.pickup_lng);

    // ── Load booking data ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!bookingId) return;
        nodeApi.get<{ data: BookingData }>(`/bookings/${bookingId}`)
            .then(r => {
                setBooking(r.data);
                setLiveEta(r.data.eta_minutes ?? null);
                setLiveDistKm(r.data.distance_km ?? null);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [bookingId]);

    // ── Sync status changes from socket ──────────────────────────────────────
    useEffect(() => {
        if (liveStatus?.status) {
            setBooking(prev => prev ? { ...prev, status: liveStatus.status } : prev);
        }
    }, [liveStatus]);

    // ── Live ETA recalc on each GPS update ───────────────────────────────────
    useEffect(() => {
        if (!location || !booking?.pickup_lat || !booking?.pickup_lng) return;

        // Quick haversine estimate while OSRM recalc is pending
        const driverSpeed = Math.max(location.speed || 0, 20); // floor at 20 km/h
        const eta = haversineEta(
            location.latitude, location.longitude,
            booking.pickup_lat, booking.pickup_lng,
            driverSpeed
        );

        // Straight-line km estimate (* 1.3 road factor)
        const R = 6371;
        const dLat = ((booking.pickup_lat - location.latitude) * Math.PI) / 180;
        const dLng = ((booking.pickup_lng - location.longitude) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((location.latitude * Math.PI) / 180) *
            Math.cos((booking.pickup_lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3).toFixed(2));

        setLiveEta(eta);
        setLiveDistKm(dist);
    }, [location, booking?.pickup_lat, booking?.pickup_lng]);

    // ── Apply server-side OSRM route + ETA refresh ───────────────────────────
    useEffect(() => {
        if (!routeUpdate) return;
        if (routeUpdate.eta_minutes)    setLiveEta(routeUpdate.eta_minutes);
        if (routeUpdate.distance_km)    setLiveDistKm(routeUpdate.distance_km);
        if (routeUpdate.route_geometry) setLiveRoute(routeUpdate.route_geometry);
    }, [routeUpdate]);

    // ── Route geometry (initial booking route or live refresh) ───────────────
    const routeGeo = (liveRoute || (booking?.route_geometry ? (() => {
        try { return JSON.parse(booking.route_geometry!); } catch { return null; }
    })() : null)) as { type: string; coordinates: [number, number][] } | null;

    // ── Cancel booking ────────────────────────────────────────────────────────
    const handleCancel = useCallback(async () => {
        if (cancelling) return;
        setCancelling(true);
        try {
            await nodeApi.patch(`/bookings/${bookingId}/cancel`, {});
            setBooking(prev => prev ? { ...prev, status: 'cancelled' } : prev);
        } catch {
        } finally {
            setCancelling(false);
        }
    }, [bookingId, cancelling]);

    // ─────────────────────────────────────────────────────────────────────────

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-50">
            <div className="text-center">
                <div className="text-6xl mb-4 animate-bounce">🚜</div>
                <p className="text-gray-500 text-sm font-medium">Loading tracking info…</p>
            </div>
        </div>
    );

    if (!booking) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
                <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Booking not found.</p>
                <button type="button" onClick={() => router.back()} className="mt-4 text-green-600 hover:underline text-sm">Go back</button>
            </div>
        </div>
    );

    const isActive = ['requested', 'accepted', 'in_progress'].includes(booking.status);

    /* Share PIN from last 4 chars of bookingId */
    const sharePin = bookingId.slice(-4).toUpperCase();

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-gray-900">

            {/* ── Floating header (over map) ─────────────────────────── */}
            <div className="absolute top-0 left-0 right-0 z-50 px-4 pt-4 flex items-center gap-3 pointer-events-none">
                <button
                    type="button"
                    aria-label="Go back"
                    onClick={() => router.back()}
                    className="pointer-events-auto p-2.5 bg-white rounded-full shadow-lg hover:bg-gray-50 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-800" />
                </button>

                <div className="pointer-events-auto flex-1 bg-white/95 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg flex items-center justify-between">
                    <div className="min-w-0">
                        <p className="font-bold text-gray-900 text-sm truncate">
                            {booking.equipment?.name ?? 'Live Tracking'}
                        </p>
                        <p className="text-[10px] text-gray-400 font-mono">
                            #{booking.id.slice(0, 8).toUpperCase()}
                        </p>
                    </div>
                    {/* Connection dot */}
                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                        connectionState === 'connected'
                            ? 'bg-green-50 text-green-700'
                            : connectionState === 'reconnecting'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-red-50 text-red-600'
                    }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                            connectionState === 'connected' ? 'bg-green-500 animate-pulse' :
                            connectionState === 'reconnecting' ? 'bg-amber-500' : 'bg-red-500'
                        }`} />
                        {connectionState === 'connected' ? 'Live' : connectionState === 'reconnecting' ? 'Reconnecting' : 'Offline'}
                    </div>
                </div>

                {booking.status === 'completed' && (
                    <button
                        type="button"
                        onClick={() => router.push(`/tracking/${bookingId}/history`)}
                        aria-label="Replay trip history"
                        className="pointer-events-auto p-2.5 bg-white rounded-full shadow-lg hover:bg-gray-50 transition-colors"
                    >
                        <RotateCcw className="w-4 h-4 text-gray-700" />
                    </button>
                )}
            </div>

            {/* ── Full-screen Map ────────────────────────────────────── */}
            <div className="flex-1 relative">
                <TrackingMap
                    bookingId={bookingId}
                    initialLat={booking.pickup_lat ?? 17.385}
                    initialLng={booking.pickup_lng ?? 78.4867}
                    pickupLat={booking.pickup_lat}
                    pickupLng={booking.pickup_lng}
                    dropoffLat={booking.dropoff_lat}
                    dropoffLng={booking.dropoff_lng}
                    routeGeometry={routeGeo}
                />
                {/* Location info strip (floating bottom of map) */}
                {location && isActive && (
                    <div className="absolute bottom-3 left-3 right-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                        <span className="text-white text-[11px] flex-1 truncate">
                            {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
                            {location.speed > 0 && ` · ${location.speed.toFixed(1)} km/h`}
                        </span>
                        <span className="text-white/50 text-[10px]">
                            {new Date(location.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                )}
            </div>

            {/* ── Bottom Sheet ───────────────────────────────────────── */}
            <div className="bg-white rounded-t-3xl shadow-2xl flex-shrink-0 px-4 pb-6 pt-4 max-h-[55vh] overflow-y-auto">
                {/* Handle bar */}
                <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

                {/* Booking status bar */}
                <BookingStatusBar status={booking.status} />

                {/* ── ETA + Distance row ── */}
                {isActive && (
                    <div className="grid grid-cols-2 gap-3 my-4">
                        {/* ETA */}
                        <div className="bg-slate-900 rounded-2xl p-4 text-center">
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">ETA</p>
                            <p className="text-white font-extrabold text-3xl leading-none">
                                {liveEta == null ? '—' : liveEta < 1 ? 'Now' : `${liveEta}`}
                            </p>
                            {liveEta != null && liveEta >= 1 && (
                                <p className="text-slate-400 text-xs mt-0.5">minutes</p>
                            )}
                        </div>
                        {/* Distance */}
                        <div className="bg-slate-900 rounded-2xl p-4 text-center">
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1">Distance</p>
                            <p className="text-white font-extrabold text-3xl leading-none">
                                {liveDistKm == null ? '—'
                                    : liveDistKm < 1 ? `${Math.round(liveDistKm * 1000)}`
                                    : liveDistKm.toFixed(1)}
                            </p>
                            <p className="text-slate-400 text-xs mt-0.5">
                                {liveDistKm != null && liveDistKm < 1 ? 'meters' : 'km'}
                            </p>
                        </div>
                    </div>
                )}

                {/* ── Pickup point + Share PIN ── */}
                {isActive && (
                    <div className="bg-gray-50 rounded-2xl p-4 mb-4">
                        <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-400 font-medium mb-0.5">Meet at pickup point</p>
                                <p className="font-bold text-gray-900 text-sm truncate">
                                    {booking.equipment?.name ?? 'Equipment Pickup'}
                                </p>
                            </div>
                            {/* Share PIN */}
                            <div className="flex-shrink-0 ml-3">
                                <p className="text-[10px] text-gray-400 font-medium text-right mb-1">Share PIN</p>
                                <div className="flex gap-1">
                                    {sharePin.split('').map((ch, i) => (
                                        <div key={i} className="w-7 h-8 bg-green-700 rounded-lg flex items-center justify-center text-white font-extrabold text-sm shadow-sm">
                                            {ch}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Driver card ── */}
                {booking.drivers ? (
                    <div className="mb-4">
                        <DriverInfoCard
                            driver={booking.drivers}
                            eta_minutes={liveEta ?? booking.eta_minutes}
                            distance_km={liveDistKm ?? booking.distance_km}
                            speed={location?.speed}
                            isLive={isConnected && isActive && !!location}
                        />
                    </div>
                ) : isActive ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center mb-4">
                        <p className="text-2xl mb-1">🔍</p>
                        <p className="text-amber-700 font-bold text-sm">Finding nearest driver…</p>
                        <p className="text-amber-500 text-xs mt-0.5">You'll be notified once assigned</p>
                    </div>
                ) : null}

                {/* ── Booking detail rows ── */}
                <div className="space-y-1.5 mb-4">
                    {([
                        ['Equipment',  booking.equipment?.name],
                        ['Dates',      `${new Date(booking.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} → ${new Date(booking.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`],
                        ['Amount',     `₹${booking.total_amount?.toLocaleString('en-IN')}`],
                    ] as [string, string | undefined][]).map(([k, v]) => v ? (
                        <div key={k} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                            <span className="text-gray-400">{k}</span>
                            <span className="font-semibold text-gray-800">{v}</span>
                        </div>
                    ) : null)}
                </div>

                {/* ── Action buttons ── */}
                <div className="flex gap-3">
                    {isActive && booking.status === 'requested' && (
                        <button
                            type="button"
                            onClick={handleCancel}
                            disabled={cancelling}
                            className="flex-1 py-3 rounded-2xl border border-red-300 text-red-600 font-bold text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                            {cancelling ? 'Cancelling…' : 'Cancel'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => router.push(`/bookings/${bookingId}`)}
                        className="flex-1 py-3 rounded-2xl bg-green-700 hover:bg-green-800 text-white font-bold text-sm transition-colors"
                    >
                        View Booking
                    </button>
                </div>

                {/* ── Completed ── */}
                {booking.status === 'completed' && (
                    <div className="mt-4 bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                        <p className="text-2xl mb-1">✅</p>
                        <p className="font-extrabold text-green-800">Trip Completed!</p>
                        <p className="text-green-600 text-xs mt-1">Equipment has been delivered successfully.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
