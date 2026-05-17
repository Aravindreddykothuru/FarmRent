"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Booking {
  id: string;
  equipment_id: string;
  owner_id: string;
  status: "pending" | "confirmed" | "active" | "returned";
}

interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;       // km/h
  heading: number | null;
  altitude: number | null;
  battery_level: number | null;
  source: "mobile_gps";
  equipment_id: string;
  booking_id: string;
}

interface BroadcastStats {
  pointsSent: number;
  sessionStarted: Date | null;
  lastSentAt: Date | null;
  currentLat: number | null;
  currentLng: number | null;
  currentAccuracy: number | null;
  currentSpeed: number | null;
  currentHeading: number | null;
  batteryLevel: number | null;
  distanceTraveled: number; // meters
}

interface OwnerGPSBroadcasterProps {
  booking: Booking;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingToDirection(heading: number | null): string {
  if (heading === null) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(heading / 45) % 8];
}

function secondsAgo(date: Date | null): string {
  if (!date) return "Never";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    if ("getBattery" in navigator) {
      // @ts-ignore — experimental API
      const battery = await (navigator as any).getBattery();
      return Math.round(battery.level * 100);
    }
  } catch {}
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OwnerGPSBroadcaster({ booking }: OwnerGPSBroadcasterProps) {
  const supabase = createClientComponentClient();

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState(0); // forces re-render every second

  const [stats, setStats] = useState<BroadcastStats>({
    pointsSent: 0,
    sessionStarted: null,
    lastSentAt: null,
    currentLat: null,
    currentLng: null,
    currentAccuracy: null,
    currentSpeed: null,
    currentHeading: null,
    batteryLevel: null,
    distanceTraveled: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const lastSentPointRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);

  // ── Tick every second to update "X seconds ago" display ───────────────────
  useEffect(() => {
    tickerRef.current = setInterval(() => setTicker((t) => t + 1), 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // ── Send a single location point to Supabase ──────────────────────────────
  const sendLocationPoint = useCallback(
    async (point: LocationPoint) => {
      const { error: dbError } = await supabase
        .from("equipment_locations")
        .insert(point);

      if (dbError) {
        console.error("GPS insert error:", dbError.message);
        setError(`DB error: ${dbError.message}`);
        return false;
      }
      return true;
    },
    [supabase]
  );

  // ── Handle each GPS position update ───────────────────────────────────────
  const handlePosition = useCallback(
    async (position: GeolocationPosition) => {
      setError(null);

      const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } =
        position.coords;

      const now = Date.now();
      const last = lastSentPointRef.current;

      // Only send if moved > 10m OR > 30s since last update
      const distFromLast = last ? haversineDistance(last.lat, last.lng, lat, lng) : Infinity;
      const timeFromLast = last ? (now - last.time) / 1000 : Infinity;

      const shouldSend = distFromLast > 10 || timeFromLast > 30;

      // Always update UI state
      const battery = await getBatteryLevel();
      const speedKmh = speed !== null ? parseFloat((speed * 3.6).toFixed(1)) : null;

      setStats((prev) => ({
        ...prev,
        currentLat: lat,
        currentLng: lng,
        currentAccuracy: accuracy ? parseFloat(accuracy.toFixed(1)) : null,
        currentSpeed: speedKmh,
        currentHeading: heading,
        batteryLevel: battery,
        distanceTraveled:
          last ? prev.distanceTraveled + distFromLast : prev.distanceTraveled,
      }));

      if (shouldSend) {
        const point: LocationPoint = {
          equipment_id: booking.equipment_id,
          booking_id: booking.id,
          lat,
          lng,
          accuracy: accuracy ? parseFloat(accuracy.toFixed(2)) : null,
          speed: speedKmh,
          heading: heading ? parseFloat(heading.toFixed(1)) : null,
          altitude: altitude ? parseFloat(altitude.toFixed(1)) : null,
          battery_level: battery,
          source: "mobile_gps",
        };

        const ok = await sendLocationPoint(point);
        if (ok) {
          lastSentPointRef.current = { lat, lng, time: now };
          setStats((prev) => ({
            ...prev,
            pointsSent: prev.pointsSent + 1,
            lastSentAt: new Date(),
          }));
        }
      }
    },
    [booking, sendLocationPoint]
  );

  // ── Handle GPS errors ──────────────────────────────────────────────────────
  const handleGPSError = useCallback((err: GeolocationPositionError) => {
    const messages: Record<number, string> = {
      1: "Location access denied. Please allow location permission in your browser settings, then try again.",
      2: "GPS signal not available. Move to an open area with clear sky view.",
      3: "Location request timed out. Retrying automatically...",
    };
    setError(messages[err.code] || "Unknown GPS error. Please refresh and try again.");
  }, []);

  // ── Start broadcasting ─────────────────────────────────────────────────────
  const startBroadcasting = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("GPS is not supported on this device or browser.");
      return;
    }

    setError(null);
    setStats((prev) => ({
      ...prev,
      pointsSent: 0,
      sessionStarted: new Date(),
      lastSentAt: null,
      distanceTraveled: 0,
    }));
    lastSentPointRef.current = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handleGPSError,
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );

    setIsActive(true);
  }, [handlePosition, handleGPSError]);

  // ── Stop broadcasting ──────────────────────────────────────────────────────
  const stopBroadcasting = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsActive(false);
    lastSentPointRef.current = null;
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Guard: only show for active bookings
  if (booking.status !== "active") {
    return (
      <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
        📍 GPS Broadcasting is only available when the booking is{" "}
        <strong>Active</strong>. Current status:{" "}
        <span className="font-semibold capitalize">{booking.status}</span>
      </div>
    );
  }

  const sessionDuration = stats.sessionStarted
    ? Math.floor((Date.now() - stats.sessionStarted.getTime()) / 1000)
    : 0;
  const sessionMins = Math.floor(sessionDuration / 60);
  const sessionSecs = sessionDuration % 60;
  const distKm = (stats.distanceTraveled / 1000).toFixed(2);

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isActive && (
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
          )}
          <h3 className="text-base font-semibold text-gray-900">
            {isActive ? "Broadcasting Live Location" : "GPS Location Broadcaster"}
          </h3>
        </div>
        {stats.batteryLevel !== null && (
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              stats.batteryLevel > 30
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            🔋 {stats.batteryLevel}%
          </div>
        )}
      </div>

      {/* ── Error Banner ────────────────────────────────────── */}
      {error && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span className="shrink-0">⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* ── Toggle Button ───────────────────────────────────── */}
      <button
        onClick={isActive ? stopBroadcasting : startBroadcasting}
        className={`w-full rounded-xl px-6 py-4 text-base font-semibold transition-all duration-200 ${
          isActive
            ? "bg-red-500 text-white shadow-md hover:bg-red-600 active:scale-95"
            : "bg-green-500 text-white shadow-md hover:bg-green-600 active:scale-95"
        }`}
      >
        {isActive ? "⏹ Stop Broadcasting Location" : "📡 Start Broadcasting Location"}
      </button>

      {/* ── Live Stats Grid (shown only when active) ────────── */}
      {isActive && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label="Latitude"
            value={stats.currentLat?.toFixed(6) ?? "Getting..."}
            icon="🌐"
          />
          <StatCard
            label="Longitude"
            value={stats.currentLng?.toFixed(6) ?? "Getting..."}
            icon="🌐"
          />
          <StatCard
            label="Accuracy"
            value={stats.currentAccuracy ? `±${stats.currentAccuracy}m` : "—"}
            icon="🎯"
          />
          <StatCard
            label="Speed"
            value={
              stats.currentSpeed !== null
                ? `${stats.currentSpeed} km/h`
                : "Stationary"
            }
            icon="💨"
          />
          <StatCard
            label="Direction"
            value={headingToDirection(stats.currentHeading)}
            icon="🧭"
          />
          <StatCard
            label="Distance"
            value={`${distKm} km`}
            icon="📏"
          />
          <StatCard
            label="Points Sent"
            value={String(stats.pointsSent)}
            icon="📤"
          />
          <StatCard
            label="Last Sent"
            value={secondsAgo(stats.lastSentAt)}
            icon="🕐"
          />
          <StatCard
            label="Session"
            value={`${sessionMins}m ${sessionSecs}s`}
            icon="⏱"
          />
        </div>
      )}

      {/* ── Warning Banner ──────────────────────────────────── */}
      {isActive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>⚠️ Important:</strong> Keep this tab open and screen on for continuous
          tracking. Closing the browser or locking the screen will stop location updates.
          The renter can see your live position on their tracking map.
        </div>
      )}

      {/* ── Inactive Info ───────────────────────────────────── */}
      {!isActive && !error && (
        <p className="text-center text-xs text-gray-400">
          Tap the button above to share your live location with the renter.
          Your location updates every 10–30 seconds automatically.
        </p>
      )}
    </div>
  );
}

// ─── Stat Card Sub-component ──────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}
