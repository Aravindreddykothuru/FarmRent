"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;       // km/h
  heading: number | null;
  altitude: number | null;
  updated_at: string;         // ISO timestamp from DB
}

export interface TrackingState {
  // Connection
  isConnected: boolean;
  isReconnecting: boolean;
  connectionStatus: "connecting" | "connected" | "reconnecting" | "disconnected";

  // Location
  currentLocation: LocationPoint | null;
  locationHistory: LocationPoint[];   // All points this session (for path/trail)
  totalDistance: number;              // meters traveled (sum of Haversine steps)

  // Signal
  isSignalLost: boolean;              // No update for > 3 minutes
  secondsSinceUpdate: number;         // Live counter
  lastUpdateAt: Date | null;

  // Derived display values
  speedDisplay: string;               // "25 km/h" or "Stationary"
  directionDisplay: string;           // "NE", "S", etc.
  accuracyDisplay: string;            // "±15m"
  distanceDisplay: string;            // "1.23 km"

  // Error
  error: string | null;
}

interface UseEquipmentTrackingOptions {
  bookingId: string;
  enabled?: boolean;               // Set false to pause subscription
  signalLostThresholdMs?: number;  // Default: 3 minutes
  maxHistoryPoints?: number;       // Default: 500
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingToCompass(heading: number | null): string {
  if (heading === null || heading < 0) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
  return dirs[Math.round(heading / 45)];
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatSpeed(speedKmh: number | null): string {
  if (speedKmh === null || speedKmh <= 0.5) return "Stationary";
  return `${speedKmh.toFixed(1)} km/h`;
}

// ─── Default State ────────────────────────────────────────────────────────────

const DEFAULT_STATE: TrackingState = {
  isConnected: false,
  isReconnecting: false,
  connectionStatus: "connecting",
  currentLocation: null,
  locationHistory: [],
  totalDistance: 0,
  isSignalLost: false,
  secondsSinceUpdate: 0,
  lastUpdateAt: null,
  speedDisplay: "—",
  directionDisplay: "—",
  accuracyDisplay: "—",
  distanceDisplay: "0 m",
  error: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useEquipmentTracking({
  bookingId,
  enabled = true,
  signalLostThresholdMs = 3 * 60 * 1000,   // 3 minutes
  maxHistoryPoints = 500,
}: UseEquipmentTrackingOptions): TrackingState {
  const supabase = createClientComponentClient();
  const [state, setState] = useState<TrackingState>(DEFAULT_STATE);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastUpdateAtRef = useRef<Date | null>(null);
  const historyRef = useRef<LocationPoint[]>([]);
  const totalDistanceRef = useRef(0);

  // ── Helper: Derive display values from a location point ──────────────────
  const deriveDisplayValues = useCallback(
    (point: LocationPoint, totalDist: number) => ({
      speedDisplay: formatSpeed(point.speed),
      directionDisplay: headingToCompass(point.heading),
      accuracyDisplay: point.accuracy ? `±${Math.round(point.accuracy)}m` : "—",
      distanceDisplay: formatDistance(totalDist),
    }),
    []
  );

  // ── Process a new incoming location point ─────────────────────────────────
  const processNewPoint = useCallback(
    (rawPoint: Record<string, any>) => {
      const point: LocationPoint = {
        lat: parseFloat(rawPoint.lat),
        lng: parseFloat(rawPoint.lng),
        accuracy: rawPoint.accuracy ? parseFloat(rawPoint.accuracy) : null,
        speed: rawPoint.speed ? parseFloat(rawPoint.speed) : null,
        heading: rawPoint.heading ? parseFloat(rawPoint.heading) : null,
        altitude: rawPoint.altitude ? parseFloat(rawPoint.altitude) : null,
        updated_at: rawPoint.updated_at,
      };

      // Validate coordinates
      if (
        isNaN(point.lat) || isNaN(point.lng) ||
        point.lat < -90 || point.lat > 90 ||
        point.lng < -180 || point.lng > 180
      ) {
        console.warn("Invalid GPS coordinates received:", rawPoint);
        return;
      }

      // Calculate incremental distance
      const prev = historyRef.current[historyRef.current.length - 1];
      if (prev) {
        const distStep = haversineMeters(prev.lat, prev.lng, point.lat, point.lng);
        // Ignore GPS jitter (< 2m jumps when stationary)
        if (distStep > 2) {
          totalDistanceRef.current += distStep;
        }
      }

      // Update history (cap at maxHistoryPoints)
      historyRef.current = [...historyRef.current, point].slice(-maxHistoryPoints);
      lastUpdateAtRef.current = new Date();

      const displayValues = deriveDisplayValues(point, totalDistanceRef.current);

      setState((prev) => ({
        ...prev,
        currentLocation: point,
        locationHistory: historyRef.current,
        totalDistance: totalDistanceRef.current,
        lastUpdateAt: lastUpdateAtRef.current,
        secondsSinceUpdate: 0,
        isSignalLost: false,
        error: null,
        ...displayValues,
      }));
    },
    [maxHistoryPoints, deriveDisplayValues]
  );

  // ── Fetch initial (latest) location from DB ───────────────────────────────
  const fetchInitialLocation = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_latest_location", {
        p_booking_id: bookingId,
      });

      if (error) throw error;
      if (data && data.length > 0) {
        processNewPoint(data[0]);
      }
    } catch (err: any) {
      console.warn("Could not fetch initial location:", err?.message);
      // Non-fatal — Realtime will populate once owner starts broadcasting
    }
  }, [bookingId, supabase, processNewPoint]);

  // ── Subscribe to Supabase Realtime ────────────────────────────────────────
  const subscribe = useCallback(() => {
    if (!enabled || !bookingId) return;

    // Tear down any existing subscription first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      connectionStatus: reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      isReconnecting: reconnectAttemptsRef.current > 0,
    }));

    const channel = supabase
      .channel(`equipment-tracking-${bookingId}`, {
        config: { broadcast: { ack: true } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "equipment_locations",
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          processNewPoint(payload.new as Record<string, any>);
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          reconnectAttemptsRef.current = 0;
          setState((prev) => ({
            ...prev,
            isConnected: true,
            isReconnecting: false,
            connectionStatus: "connected",
            error: null,
          }));
          // Fetch latest location immediately after connecting
          fetchInitialLocation();
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState((prev) => ({
            ...prev,
            isConnected: false,
            connectionStatus: "reconnecting",
            isReconnecting: true,
            error: "Realtime connection lost. Reconnecting...",
          }));
          scheduleReconnect();
        }

        if (status === "CLOSED") {
          setState((prev) => ({
            ...prev,
            isConnected: false,
            connectionStatus: "disconnected",
            isReconnecting: false,
          }));
        }
      });

    channelRef.current = channel;
  }, [bookingId, enabled, supabase, processNewPoint, fetchInitialLocation]);

  // ── Exponential backoff reconnect ─────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    reconnectAttemptsRef.current += 1;
    const delay = Math.min(
      1000 * 2 ** reconnectAttemptsRef.current, // 2s, 4s, 8s, 16s...
      30000 // cap at 30s
    );

    console.log(
      `Reconnecting in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current})`
    );

    reconnectTimerRef.current = setTimeout(() => {
      subscribe();
    }, delay);
  }, [subscribe]);

  // ── Setup subscription on mount / bookingId change ────────────────────────
  useEffect(() => {
    if (!enabled) return;

    subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [bookingId, enabled]);

  // ── Tick every second: update secondsSinceUpdate + detect signal loss ─────
  useEffect(() => {
    tickerRef.current = setInterval(() => {
      setState((prev) => {
        if (!prev.lastUpdateAt) return prev;

        const secondsSince = Math.floor(
          (Date.now() - prev.lastUpdateAt.getTime()) / 1000
        );
        const isSignalLost = Date.now() - prev.lastUpdateAt.getTime() > signalLostThresholdMs;

        return {
          ...prev,
          secondsSinceUpdate: secondsSince,
          isSignalLost,
        };
      });
    }, 1000);

    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [signalLostThresholdMs]);

  return state;
}

// ─── Coordinate Utilities (export for use in map components) ──────────────────

export { haversineMeters, headingToCompass, formatDistance, formatSpeed };
