'use client';
/**
 * useDriverGPS.ts — Production-grade GPS hook for driver side
 *
 * Features:
 *  • High-accuracy GPS watchPosition with client-side Kalman filter
 *  • Heading smoothing via circular interpolation
 *  • Page Visibility API: slow interval when tab hidden (10s), fast when visible (3s)
 *  • Exponential back-off reconnect for Socket.IO
 *  • REST fallback batch when socket disconnected
 *  • GPS quality indicator (accuracy, signal strength)
 *  • Background-to-foreground resume without re-mounting
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GPSPosition {
    latitude:  number;
    longitude: number;
    heading:   number;
    speed:     number;
    accuracy:  number;
    smoothedLat: number;
    smoothedLng: number;
    timestamp:   number;
}

export type GPSQuality = 'excellent' | 'good' | 'poor' | 'none';

export interface DriverGPSState {
    position:      GPSPosition | null;
    error:         string | null;
    isTransmitting: boolean;
    isConnected:   boolean;
    quality:       GPSQuality;
    lastSentAt:    number | null;
}

// ── Client-side 1-D Kalman filter ────────────────────────────────────────────

class KalmanFilter1D {
    private P = 1;
    private x: number | null = null;
    constructor(private Q = 1e-6, private R = 0.0001) {}
    filter(z: number, accuracy = 10) {
        // Adaptive R based on GPS accuracy
        this.R = Math.max(1e-10, (Math.max(accuracy, 0.5) * 9e-6) ** 2);
        if (this.x === null) { this.x = z; return z; }
        this.P = this.P + this.Q;
        const K = this.P / (this.P + this.R);
        this.x = this.x + K * (z - this.x);
        this.P = (1 - K) * this.P;
        return this.x;
    }
    reset() { this.x = null; this.P = 1; }
}

/** Smooth heading via circular interpolation (avoids 359→1° jump) */
function smoothHeading(prev: number | null, next: number, alpha = 0.3): number {
    if (prev == null) return next;
    const diff = ((next - prev + 540) % 360) - 180;
    return (prev + alpha * diff + 360) % 360;
}

/** GPS accuracy → quality label */
function getQuality(accuracy: number): GPSQuality {
    if (accuracy <= 5)   return 'excellent';
    if (accuracy <= 20)  return 'good';
    if (accuracy <= 100) return 'poor';
    return 'none';
}

function getSocketOrigin(): string {
    const fromEnv = (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    if (typeof window !== 'undefined') return window.location.origin;
    return 'http://localhost:3000';
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDriverGPS(
    driverId:  string | null,
    bookingId: string | null,
    enabled:   boolean
): DriverGPSState {
    const [state, setState] = useState<DriverGPSState>({
        position: null, error: null,
        isTransmitting: false, isConnected: false,
        quality: 'none', lastSentAt: null,
    });

    const socketRef    = useRef<Socket | null>(null);
    const watchIdRef   = useRef<number | null>(null);
    const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
    const positionRef  = useRef<GPSPosition | null>(null);
    const latKalman    = useRef(new KalmanFilter1D());
    const lngKalman    = useRef(new KalmanFilter1D());
    const prevHeading  = useRef<number | null>(null);
    const pendingBatch = useRef<object[]>([]); // REST fallback queue
    const retryCount   = useRef(0);
    const isVisible    = useRef(true);

    const sendLocation = useCallback((pos: GPSPosition, socket: Socket | null) => {
        if (!driverId) return;
        const payload = {
            driverId,
            bookingId:  bookingId || undefined,
            latitude:   pos.smoothedLat,
            longitude:  pos.smoothedLng,
            heading:    pos.heading,
            speed:      pos.speed,
            accuracy:   pos.accuracy,
        };

        if (socket?.connected) {
            socket.emit('driver:location_update', payload);
            setState(s => ({ ...s, lastSentAt: Date.now() }));
        } else {
            // Queue for REST batch flush
            pendingBatch.current.push(payload);
            if (pendingBatch.current.length >= 5) flushBatch();
        }
    }, [driverId, bookingId]);

    const flushBatch = useCallback(async () => {
        if (!pendingBatch.current.length) return;
        const batch = [...pendingBatch.current];
        pendingBatch.current = [];
        // Send last point via REST fallback
        const last = batch[batch.length - 1] as Record<string, unknown>;
        try {
            const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
            await fetch('/api/v1/tracking/driver-location', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ ...last, bookingId }),
            });
        } catch { /* offline — drop */ }
    }, [bookingId]);

    useEffect(() => {
        if (!enabled || !driverId) return;
        if (typeof window === 'undefined') return;

        // ── Page Visibility API ──────────────────────────────────────────────
        const onVisChange = () => {
            isVisible.current = !document.hidden;
            // Reschedule interval at appropriate frequency
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
                if (positionRef.current) sendLocation(positionRef.current, socketRef.current);
            }, isVisible.current ? 3000 : 10000);
        };
        document.addEventListener('visibilitychange', onVisChange);

        // ── Socket.IO connection with exponential back-off ──────────────────
        const token = localStorage.getItem('authToken');
        const connectSocket = () => {
            const socket = io(`${getSocketOrigin()}/tracking`, {
                auth: { token },
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 15,
                reconnectionDelay: Math.min(1000 * 2 ** retryCount.current, 30000),
                timeout: 10000,
            });
            socketRef.current = socket;

            socket.on('connect', () => {
                retryCount.current = 0;
                setState(s => ({ ...s, isConnected: true, isTransmitting: true }));
                // Register as driver
                socket.emit('driver:register', { driverId });
                if (bookingId) socket.emit('driver:trip_started', { driverId, bookingId });
                // Flush any queued REST batch immediately
                flushBatch();
            });

            socket.on('disconnect', (reason) => {
                setState(s => ({ ...s, isConnected: false, isTransmitting: false }));
                // Socket.IO auto-reconnects unless manually disconnected
                if (reason === 'io server disconnect') {
                    retryCount.current++;
                    setTimeout(connectSocket, Math.min(1000 * 2 ** retryCount.current, 30000));
                }
            });

            socket.on('gps:rejected', () => { /* server rejected GPS point */ });

            socket.on('gps:warning', () => { /* server GPS warning */ });

            socket.on('force_disconnect', () => {
                socket.disconnect();
            });
        };
        connectSocket();

        // ── Geolocation watch ────────────────────────────────────────────────
        if (!navigator.geolocation) {
            setState(s => ({ ...s, error: 'Geolocation not supported by this browser' }));
            return;
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
            (geo) => {
                const rawLat = geo.coords.latitude;
                const rawLng = geo.coords.longitude;
                const acc    = geo.coords.accuracy;

                // Client-side Kalman filter
                const sLat = latKalman.current.filter(rawLat, acc);
                const sLng = lngKalman.current.filter(rawLng, acc);

                // Heading smoothing
                const rawH = geo.coords.heading ?? 0;
                const heading = smoothHeading(prevHeading.current, rawH);
                prevHeading.current = heading;

                const pos: GPSPosition = {
                    latitude:    rawLat,
                    longitude:   rawLng,
                    smoothedLat: sLat,
                    smoothedLng: sLng,
                    heading,
                    speed:       (geo.coords.speed ?? 0) * 3.6, // m/s → km/h
                    accuracy:    acc,
                    timestamp:   Date.now(),
                };

                positionRef.current = pos;
                setState(s => ({
                    ...s, position: pos, error: null,
                    quality: getQuality(acc),
                }));
            },
            (err) => {
                setState(s => ({ ...s, error: err.message, quality: 'none' }));
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
        );

        // ── Transmit interval (3s foreground, 10s background) ───────────────
        intervalRef.current = setInterval(() => {
            if (positionRef.current) {
                sendLocation(positionRef.current, socketRef.current);
                setState(s => ({ ...s, isTransmitting: socketRef.current?.connected ?? false }));
            }
        }, 3000);

        return () => {
            document.removeEventListener('visibilitychange', onVisChange);
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
            }
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (socketRef.current) {
                if (driverId && bookingId) {
                    socketRef.current.emit('driver:trip_ended', { driverId, bookingId });
                }
                socketRef.current.disconnect();
            }
            flushBatch();
            latKalman.current.reset();
            lngKalman.current.reset();
            prevHeading.current = null;
            setState(s => ({ ...s, isConnected: false, isTransmitting: false }));
        };
    }, [enabled, driverId, bookingId]); // sendLocation/flushBatch are stable refs — intentionally omitted

    return state;
}
