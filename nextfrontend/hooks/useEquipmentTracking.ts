'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocationPoint {
  lat:        number;
  lng:        number;
  accuracy:   number | null;
  speed:      number | null;    // km/h
  heading:    number | null;
  altitude:   number | null;
  updated_at: string;           // ISO timestamp from DB
}

export interface TrackingState {
  // Connection
  isConnected:      boolean;
  isReconnecting:   boolean;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

  // Location
  currentLocation:  LocationPoint | null;
  locationHistory:  LocationPoint[];  // All points this session (for path/trail)
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
  enabled?:               boolean;  // Set false to pause subscription
  signalLostThresholdMs?: number;   // Default: 3 minutes
  maxHistoryPoints?:      number;   // Default: 500
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

  const channelRef          = useRef<RealtimeChannel | null>(null);
  const reconnectTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastUpdateAtRef     = useRef<Date | null>(null);
  const historyRef          = useRef<LocationPoint[]>([]);
  const totalDistanceRef    = useRef(0);

  // ── Derive display values from a location point ───────────────────────────
  const deriveDisplayValues = useCallback(
    (point: LocationPoint, totalDist: number) => ({
      speedDisplay:     formatSpeed(point.speed),
      directionDisplay: headingToCompass(point.heading),
      accuracyDisplay:  point.accuracy ? `±${Math.round(point.accuracy)}m` : '—',
      distanceDisplay:  formatDistance(totalDist),
    }),
    [],
  );

  // ── Process a new incoming location point ─────────────────────────────────
  const processNewPoint = useCallback(
    (rawPoint: Record<string, unknown>) => {
      const point: LocationPoint = {
        lat:        parseFloat(String(rawPoint.lat)),
        lng:        parseFloat(String(rawPoint.lng)),
        accuracy:   rawPoint.accuracy  ? parseFloat(String(rawPoint.accuracy))  : null,
        speed:      rawPoint.speed     ? parseFloat(String(rawPoint.speed))     : null,
        heading:    rawPoint.heading   ? parseFloat(String(rawPoint.heading))   : null,
        altitude:   rawPoint.altitude  ? parseFloat(String(rawPoint.altitude))  : null,
        updated_at: String(rawPoint.updated_at ?? new Date().toISOString()),
      };

      // Validate coordinates
      if (
        isNaN(point.lat) || isNaN(point.lng) ||
        point.lat < -90  || point.lat > 90   ||
        point.lng < -180 || point.lng > 180
      ) {
        console.warn('Invalid GPS coordinates received:', rawPoint);
        return;
      }

      // Calculate incremental distance, ignore GPS jitter < 2 m when stationary
      const prev = historyRef.current[historyRef.current.length - 1];
      if (prev) {
        const step = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
        if (step > 2) totalDistanceRef.current += step;
      }

      historyRef.current  = [...historyRef.current, point].slice(-maxHistoryPoints);
      lastUpdateAtRef.current = new Date();

      setState(prev => ({
        ...prev,
        currentLocation:   point,
        locationHistory:   historyRef.current,
        totalDistance:     totalDistanceRef.current,
        lastUpdateAt:      lastUpdateAtRef.current,
        secondsSinceUpdate: 0,
        isSignalLost:      false,
        error:             null,
        ...deriveDisplayValues(point, totalDistanceRef.current),
      }));
    },
    [maxHistoryPoints, deriveDisplayValues],
  );

  // ── Fetch latest location from DB on connect ──────────────────────────────
  const fetchInitialLocation = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('equipment_locations')
        .select('lat, lng, accuracy, speed, heading, altitude, updated_at')
        .eq('booking_id', bookingId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();
      if (error) throw error;
      if (data) processNewPoint(data as Record<string, unknown>);
    } catch (err: unknown) {
      // Non-fatal — Realtime will populate once owner starts broadcasting
      console.warn('Could not fetch initial location:', (err as Error)?.message);
    }
  }, [bookingId, processNewPoint]);

  // ── Exponential backoff reconnect ─────────────────────────────────────────
  // Declared as ref-forwarded to avoid circular dependency with subscribe
  const scheduleReconnectRef = useRef<() => void>(() => {});

  // ── Subscribe to Supabase Realtime ────────────────────────────────────────
  const subscribe = useCallback(() => {
    if (!enabled || !bookingId || !supabase) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setState(prev => ({
      ...prev,
      connectionStatus: reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting',
      isReconnecting:   reconnectAttemptsRef.current > 0,
    }));

    const channel = supabase
      .channel(`equipment-tracking-${bookingId}`, {
        config: { broadcast: { ack: true } },
      })
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'equipment_locations',
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          processNewPoint(payload.new as Record<string, unknown>);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          reconnectAttemptsRef.current = 0;
          setState(prev => ({
            ...prev,
            isConnected:      true,
            isReconnecting:   false,
            connectionStatus: 'connected',
            error:            null,
          }));
          fetchInitialLocation();
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setState(prev => ({
            ...prev,
            isConnected:      false,
            connectionStatus: 'reconnecting',
            isReconnecting:   true,
            error:            'Realtime connection lost. Reconnecting…',
          }));
          scheduleReconnectRef.current();
        }

        if (status === 'CLOSED') {
          setState(prev => ({
            ...prev,
            isConnected:      false,
            connectionStatus: 'disconnected',
            isReconnecting:   false,
          }));
        }
      });

    channelRef.current = channel;
  }, [bookingId, enabled, processNewPoint, fetchInitialLocation]);

  // Wire up the reconnect ref after subscribe is stable
  useEffect(() => {
    scheduleReconnectRef.current = () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectAttemptsRef.current += 1;
      const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30_000);
      reconnectTimerRef.current = setTimeout(() => subscribe(), delay);
    };
  }, [subscribe]);

  // ── Mount / bookingId change ───────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    subscribe();
    return () => {
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [bookingId, enabled, subscribe]);

  // ── Tick: update secondsSinceUpdate + detect signal loss ──────────────────
  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setState(prev => {
        if (!prev.lastUpdateAt) return prev;
        const secondsSince = Math.floor(
          (Date.now() - prev.lastUpdateAt.getTime()) / 1000,
        );
        const isSignalLost =
          Date.now() - prev.lastUpdateAt.getTime() > signalLostThresholdMs;
        return { ...prev, secondsSinceUpdate: secondsSince, isSignalLost };
      });
    }, 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [signalLostThresholdMs]);

  return state;
}
