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
import { Socket } from 'socket.io-client';
import { connectTrackingSocket } from '../lib/socket';

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
        const socket = connectTrackingSocket();
        socketRef.current = socket;

        const onConnect = () => {
            if (destroyed) return;
            setState(s => ({ ...s, isConnected: true, connectionState: 'connected' }));
            socket.emit('join_booking_room', bookingId);
        };

        const onReconnectAttempt = () => {
            setState(s => ({ ...s, connectionState: 'reconnecting' }));
        };

        const onDisconnect = () => {
            setState(s => ({ ...s, isConnected: false, connectionState: 'disconnected' }));
        };

        const onLocationUpdate = (data: LocationData) => {
            if (destroyed) return;
            setState(s => ({ ...s, location: data }));
            maybeRefreshRoute(data);
        };

        const onBookingStatusChanged = (data: BookingStatus) => {
            if (destroyed) return;
            setState(s => ({ ...s, status: data }));
        };

        const onRouteUpdate = (data: RouteUpdate) => {
            if (destroyed) return;
            setState(s => ({ ...s, routeUpdate: data }));
        };

        const onEtaUpdate = (data: RouteUpdate) => {
            if (destroyed) return;
            setState(s => ({ ...s, routeUpdate: data }));
        };

        // Wire listeners
        if (socket.connected) {
            onConnect();
        } else {
            socket.on('connect', onConnect);
        }
        socket.on('reconnect_attempt', onReconnectAttempt);
        socket.on('disconnect', onDisconnect);
        socket.on('location_update', onLocationUpdate);
        socket.on('booking:status_changed', onBookingStatusChanged);
        socket.on('route_update', onRouteUpdate);
        socket.on('eta_update', onEtaUpdate);

        return () => {
            destroyed = true;
            if (etaTimerRef.current) clearTimeout(etaTimerRef.current);
            
            socket.emit('leave_booking_room', bookingId);
            
            // Remove listeners from shared singleton
            socket.off('connect', onConnect);
            socket.off('reconnect_attempt', onReconnectAttempt);
            socket.off('disconnect', onDisconnect);
            socket.off('location_update', onLocationUpdate);
            socket.off('booking:status_changed', onBookingStatusChanged);
            socket.off('route_update', onRouteUpdate);
            socket.off('eta_update', onEtaUpdate);
            
            socketRef.current = null;
        };
    }, [bookingId, maybeRefreshRoute]);

    return state;
}
