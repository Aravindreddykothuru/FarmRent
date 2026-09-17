'use client';

/**
 * Live equipment position for one booking, over the app's authenticated /tracking socket.
 *
 * The server admits only the booking's renter, owner, assigned driver or an admin to the booking room and pushes
 * `location_update` there. The trail recorded so far comes from GET /api/v1/tracking/booking/:id/history.
 * The browser never reads location tables directly.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { connectTrackingSocket } from '@/lib/socket';
import { nodeApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocationPoint {
  lat:        number;
  lng:        number;
  accuracy:   number | null;
  speed:      number | null;    // km/h
  heading:    number | null;
  altitude:   number | null;
  updated_at: string;           // ISO timestamp
}

export interface TrackingState {
  // Connection
  isConnected:      boolean;
  isReconnecting:   boolean;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

  // Location
  currentLocation:  LocationPoint | null;
  locationHistory:  LocationPoint[];  // Trail so far (for path)
  totalDistance:    number;           // metres traveled (sum of Haversine steps)

  // Signal
  isSignalLost:      boolean;         // No update for > signalLostThresholdMs
  secondsSinceUpdate: number;         // Live counter
  lastUpdateAt:      Date | null;

  // Derived display values
  speedDisplay:     string;           // "25.0 km/h" or "Stationary"
  directionDisplay: string;           // "NE", "S", etc.
  accuracyDisplay:  string;           // "±15m"
  distanceDisplay:  string;           // "1.23 km"

  // Error
  error: string | null;
}

interface UseEquipmentTrackingOptions {
  bookingId:              string;
  enabled?:               boolean;  // Set false to pause
  signalLostThresholdMs?: number;   // Default: 3 minutes
  maxHistoryPoints?:      number;   // Default: 500
}

/** A position as the server sends it (socket payload or history row). */
interface ServerPosition {
  latitude?:   number | null;
  longitude?:  number | null;
  accuracy?:   number | null;
  speed?:      number | null;
  heading?:    number | null;
  altitude?:   number | null;
  timestamp?:  number | null;
  created_at?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function headingToCompass(heading: number | null): string {
  if (heading === null || heading < 0) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  return dirs[Math.round(heading / 45)] ?? '—';
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatSpeed(speedKmh: number | null): string {
  if (speedKmh === null || speedKmh <= 0.5) return 'Stationary';
  return `${speedKmh.toFixed(1)} km/h`;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function toPoint(raw: ServerPosition): LocationPoint | null {
  const lat = num(raw.latitude);
  const lng = num(raw.longitude);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const time = raw.timestamp ? new Date(raw.timestamp) : raw.created_at ? new Date(raw.created_at) : new Date();
  return {
    lat,
    lng,
    accuracy:   num(raw.accuracy),
    speed:      num(raw.speed),
    heading:    num(raw.heading),
    altitude:   num(raw.altitude),
    updated_at: Number.isNaN(time.getTime()) ? new Date().toISOString() : time.toISOString(),
  };
}

// ─── Default State ────────────────────────────────────────────────────────────

const DEFAULT_STATE: TrackingState = {
  isConnected:       false,
  isReconnecting:    false,
  connectionStatus:  'connecting',
  currentLocation:   null,
  locationHistory:   [],
  totalDistance:     0,
  isSignalLost:      false,
  secondsSinceUpdate: 0,
  lastUpdateAt:      null,
  speedDisplay:      '—',
  directionDisplay:  '—',
  accuracyDisplay:   '—',
  distanceDisplay:   '0 m',
  error:             null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEquipmentTracking({
  bookingId,
  enabled               = true,
  signalLostThresholdMs = 3 * 60 * 1000,
  maxHistoryPoints      = 500,
}: UseEquipmentTrackingOptions): TrackingState {
  const [state, setState] = useState<TrackingState>(DEFAULT_STATE);

  const historyRef       = useRef<LocationPoint[]>([]);
  const totalDistanceRef = useRef(0);

  const applyPoints = useCallback((points: LocationPoint[], live: boolean) => {
    if (!points.length) return;
    for (const point of points) {
      const prev = historyRef.current[historyRef.current.length - 1];
      // Ignore GPS jitter under 2 m when stationary
      if (prev) {
        const step = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
        if (step > 2) totalDistanceRef.current += step;
      }
      historyRef.current.push(point);
    }
    historyRef.current = historyRef.current.slice(-maxHistoryPoints);
    const latest = historyRef.current[historyRef.current.length - 1];
    const lastUpdateAt = live ? new Date() : new Date(latest.updated_at);

    setState(prev => ({
      ...prev,
      currentLocation:    latest,
      locationHistory:    [...historyRef.current],
      totalDistance:      totalDistanceRef.current,
      lastUpdateAt,
      secondsSinceUpdate: Math.max(0, Math.floor((Date.now() - lastUpdateAt.getTime()) / 1000)),
      isSignalLost:       Date.now() - lastUpdateAt.getTime() > signalLostThresholdMs,
      error:              null,
      speedDisplay:       formatSpeed(latest.speed),
      directionDisplay:   headingToCompass(latest.heading),
      accuracyDisplay:    latest.accuracy ? `±${Math.round(latest.accuracy)}m` : '—',
      distanceDisplay:    formatDistance(totalDistanceRef.current),
    }));
  }, [maxHistoryPoints, signalLostThresholdMs]);

  // ── Trail recorded so far, then live updates from the booking room ────────
  useEffect(() => {
    if (!enabled || !bookingId) return;
    let cancelled = false;
    historyRef.current = [];
    totalDistanceRef.current = 0;

    nodeApi.get<ServerPosition[]>(`/tracking/booking/${bookingId}/history`)
      .then((rows) => {
        if (cancelled) return;
        applyPoints((rows ?? []).map(toPoint).filter((p): p is LocationPoint => p !== null), false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(prev => ({ ...prev, error: err instanceof Error ? err.message : 'Could not load the trail' }));
      });

    const socket = connectTrackingSocket();
    const join = () => {
      socket.emit('join_booking_room', bookingId);
      setState(prev => ({ ...prev, isConnected: true, isReconnecting: false, connectionStatus: 'connected' }));
    };
    const onDisconnect = () =>
      setState(prev => ({ ...prev, isConnected: false, isReconnecting: true, connectionStatus: 'reconnecting' }));
    const onConnectError = () =>
      setState(prev => ({ ...prev, isConnected: false, isReconnecting: false, connectionStatus: 'disconnected' }));
    const onDenied = (payload: { room?: string; id?: string }) => {
      if (payload?.room !== 'booking' || payload.id !== bookingId) return;
      setState(prev => ({ ...prev, isConnected: false, connectionStatus: 'disconnected', error: 'You are not a party to this booking.' }));
    };
    const onLocation = (payload: ServerPosition & { bookingId?: string | null; fromCache?: boolean }) => {
      if (payload?.bookingId && payload.bookingId !== bookingId) return;
      const point = toPoint(payload);
      if (point) applyPoints([point], !payload.fromCache);
    };

    if (socket.connected) join();
    socket.on('connect', join);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:denied', onDenied);
    socket.on('location_update', onLocation);

    return () => {
      cancelled = true;
      socket.emit('leave_booking_room', bookingId);
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:denied', onDenied);
      socket.off('location_update', onLocation);
    };
  }, [bookingId, enabled, applyPoints]);

  // ── Tick: update secondsSinceUpdate + detect signal loss ──────────────────
  useEffect(() => {
    const ticker = setInterval(() => {
      setState(prev => {
        if (!prev.lastUpdateAt) return prev;
        const elapsed = Date.now() - prev.lastUpdateAt.getTime();
        return { ...prev, secondsSinceUpdate: Math.floor(elapsed / 1000), isSignalLost: elapsed > signalLostThresholdMs };
      });
    }, 1000);
    return () => clearInterval(ticker);
  }, [signalLostThresholdMs]);

  return state;
}
