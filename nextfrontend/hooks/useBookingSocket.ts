'use client';
/**
 * useBookingSocket.ts — Production farmer-side tracking hook
 *
 * Features:
 *  • Auto-reconnect with exponential back-off
 *  • Serves last-known position from server cache on reconnect
 *  • Live ETA recalculation via OSRM (debounced, triggered on driver movement)
 *  • Route geometry refresh when driver moves > 0.3 km from last route fetch
 *  • Deduped join (only one join_booking_room per bookingId)
 *  • Booking status change subscription
 *  • Clean teardown on unmount
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocationData {
    driverId:   string;
    latitude:   number;
    longitude:  number;
    heading:    number;
    speed:      number;
    accuracy?:  number;
    flags?:     string[];
    timestamp:  number;
    fromCache?: boolean;
}

export interface BookingStatus {
    bookingId: string;
    status:    string;
    message?:  string;
    booking?:  Record<string, unknown>;
}

export interface RouteUpdate {
    bookingId:      string;
    eta_minutes:    number;
    distance_km:    number;
    route_geometry: unknown;
    refreshedAt:    number;
}

export interface BookingSocketState {
    location:       LocationData | null;
    status:         BookingStatus | null;
    routeUpdate:    RouteUpdate | null;
    isConnected:    boolean;
    connectionState: 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
}

// ── Haversine (for route-refresh threshold) ──────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getSocketOrigin(): string {
    const fromEnv = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    if (typeof window !== 'undefined') return window.location.origin;
    return 'http://localhost:3000';
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBookingSocket(
    bookingId:  string | null,
    pickupLat?: number | null,
    pickupLng?: number | null
): BookingSocketState {
    const [state, setState] = useState<BookingSocketState>({
        location: null, status: null, routeUpdate: null,
        isConnected: false, connectionState: 'connecting',
    });

    const socketRef       = useRef<Socket | null>(null);
    const retryCount      = useRef(0);
    const lastRouteFetch  = useRef<{ lat: number; lng: number } | null>(null);
    const etaTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced route refresh — only re-fetch route when driver moved > 0.3 km
    const maybeRefreshRoute = useCallback((loc: LocationData) => {
        if (!bookingId || !pickupLat || !pickupLng) return;
        if (!socketRef.current?.connected) return;

        const last = lastRouteFetch.current;
        const dist = last
            ? haversineKm(last.lat, last.lng, loc.latitude, loc.longitude)
            : Infinity;

        if (dist < 0.3) return; // moved < 300m — don't re-fetch
        lastRouteFetch.current = { lat: loc.latitude, lng: loc.longitude };

        // Clear existing timer
        if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
        // Debounce 2s (coalesce rapid movements)
        etaTimerRef.current = setTimeout(() => {
            socketRef.current?.emit('request:route_refresh', {
                bookingId,
                driverLat: loc.latitude,
                driverLng: loc.longitude,
                pickupLat,
                pickupLng,
            });
        }, 2000);
    }, [bookingId, pickupLat, pickupLng]);

    useEffect(() => {
        if (!bookingId) return;
        if (typeof window === 'undefined') return;

        let destroyed = false;

        const connect = () => {
            if (destroyed) return;

            const token = localStorage.getItem('authToken');
            const socket = io(`${getSocketOrigin()}/tracking`, {
                auth:    { token },
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 20,
                reconnectionDelay: Math.min(500 * 2 ** retryCount.current, 30000),
                timeout: 10000,
            });
            socketRef.current = socket;

            setState(s => ({ ...s, connectionState: 'connecting' }));

            socket.on('connect', () => {
                if (destroyed) return;
                retryCount.current = 0;
                setState(s => ({ ...s, isConnected: true, connectionState: 'connected' }));
                socket.emit('join_booking_room', bookingId);
            });

            socket.on('reconnect_attempt', () => {
                setState(s => ({ ...s, connectionState: 'reconnecting' }));
            });

            socket.on('disconnect', (reason) => {
                setState(s => ({ ...s, isConnected: false, connectionState: 'disconnected' }));
                if (reason === 'io server disconnect') {
                    // Server closed connection — manual reconnect with back-off
                    retryCount.current++;
                    setTimeout(connect, Math.min(1000 * 2 ** retryCount.current, 30000));
                }
                // For transport issues Socket.IO auto-reconnects
            });

            // ── GPS location stream ─────────────────────────────────────────
            socket.on('location_update', (data: LocationData) => {
                if (destroyed) return;
                setState(s => ({ ...s, location: data }));
                maybeRefreshRoute(data);
            });

            // ── Booking lifecycle ───────────────────────────────────────────
            socket.on('booking:status_changed', (data: BookingStatus) => {
                if (destroyed) return;
                setState(s => ({ ...s, status: data }));
            });

            // ── Route / ETA refresh (from server OSRM recalc) ──────────────
            socket.on('route_update', (data: RouteUpdate) => {
                if (destroyed) return;
                setState(s => ({ ...s, routeUpdate: data }));
            });

            socket.on('eta_update', (data: RouteUpdate) => {
                if (destroyed) return;
                setState(s => ({ ...s, routeUpdate: data }));
            });
        };

        connect();

        return () => {
            destroyed = true;
            if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
            if (socketRef.current) {
                socketRef.current.emit('leave_booking_room', bookingId);
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [bookingId, maybeRefreshRoute]);

    return state;
}
