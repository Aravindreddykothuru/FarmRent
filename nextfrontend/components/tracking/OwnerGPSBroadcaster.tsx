'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  bookingId:   string;
  equipmentId: string;
}

interface BroadcastStats {
  pointsSent:      number;
  sessionStarted:  Date | null;
  lastSentAt:      Date | null;
  currentLat:      number | null;
  currentLng:      number | null;
  currentAccuracy: number | null;
  currentSpeed:    number | null;
  currentHeading:  number | null;
  batteryLevel:    number | null;
  distanceTraveled: number;       // metres
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R  = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingToDirection(heading: number | null): string {
  if (heading === null) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(heading / 45) % 8] ?? '—';
}

function secondsAgo(date: Date | null): string {
  if (!date) return 'Never';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

async function getBatteryLevel(): Promise<number | null> {
  try {
    if ('getBattery' in navigator) {
      type BatteryManager = { level: number; addEventListener(type: string, cb: () => void): void };
      const battery = await (navigator as Navigator & { getBattery(): Promise<BatteryManager> }).getBattery();
      return Math.round(battery.level * 100);
    }
  } catch { /* not supported */ }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OwnerGPSBroadcaster({ bookingId, equipmentId }: Props) {
  const [isActive, setIsActive] = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [, setTicker]           = useState(0); // forces re-render every second for "X ago" display

  const [stats, setStats] = useState<BroadcastStats>({
    pointsSent:       0,
    sessionStarted:   null,
    lastSentAt:       null,
    currentLat:       null,
    currentLng:       null,
    currentAccuracy:  null,
    currentSpeed:     null,
    currentHeading:   null,
    batteryLevel:     null,
    distanceTraveled: 0,
  });

  const watchIdRef      = useRef<number | null>(null);
  const lastSentRef     = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Ticker for "X seconds ago" display ────────────────────────────────────
  useEffect(() => {
    tickerRef.current = setInterval(() => setTicker(t => t + 1), 1000);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, []);

  // ── Insert one location point to Supabase ─────────────────────────────────
  const sendLocationPoint = useCallback(async (
    lat: number, lng: number,
    accuracy: number | null, speedKmh: number | null,
    heading: number | null, altitude: number | null,
    battery: number | null,
  ) => {
    if (!supabase) return false;
    const { error: dbError } = await supabase.from('equipment_locations').insert({
      equipment_id:  equipmentId,
      booking_id:    bookingId,
      lat,
      lng,
      accuracy:      accuracy  ? parseFloat(accuracy.toFixed(2))  : null,
      speed:         speedKmh  ? parseFloat(speedKmh.toFixed(1))  : null,
      heading:       heading   ? parseFloat(heading.toFixed(1))   : null,
      altitude:      altitude  ? parseFloat(altitude.toFixed(1))  : null,
      battery_level: battery,
      source:        'mobile_gps',
    } as Record<string, unknown>);

    if (dbError) {
      console.error('GPS insert error:', dbError.message);
      setError(`DB error: ${dbError.message}`);
      return false;
    }
    return true;
  }, [bookingId, equipmentId]);

  // ── Handle each GPS position update ──────────────────────────────────────
  const handlePosition = useCallback(async (position: GeolocationPosition) => {
    setError(null);
    const { latitude: lat, longitude: lng, accuracy, speed, heading, altitude } = position.coords;
    const now          = Date.now();
    const last         = lastSentRef.current;
    const distFromLast = last ? haversineDistance(last.lat, last.lng, lat, lng) : Infinity;
    const timeFromLast = last ? (now - last.time) / 1000 : Infinity;
    const shouldSend   = distFromLast > 10 || timeFromLast > 30;

    const battery  = await getBatteryLevel();
    const speedKmh = speed !== null ? parseFloat((speed * 3.6).toFixed(1)) : null;

    setStats(prev => ({
      ...prev,
      currentLat:       lat,
      currentLng:       lng,
      currentAccuracy:  accuracy ? parseFloat(accuracy.toFixed(1)) : null,
      currentSpeed:     speedKmh,
      currentHeading:   heading,
      batteryLevel:     battery,
      distanceTraveled: last && distFromLast < 5000
        ? prev.distanceTraveled + distFromLast
        : prev.distanceTraveled,
    }));

    if (shouldSend) {
      const ok = await sendLocationPoint(lat, lng, accuracy ?? null, speedKmh, heading ?? null, altitude ?? null, battery);
      if (ok) {
        lastSentRef.current = { lat, lng, time: now };
        setStats(prev => ({ ...prev, pointsSent: prev.pointsSent + 1, lastSentAt: new Date() }));
      }
    }
  }, [sendLocationPoint]);

  // ── GPS error handler ─────────────────────────────────────────────────────
  const handleGPSError = useCallback((err: GeolocationPositionError) => {
    const messages: Record<number, string> = {
      1: 'Location access denied. Allow location in browser settings, then try again.',
      2: 'GPS signal not available. Move to an open area.',
      3: 'Location request timed out. Retrying automatically…',
    };
    setError(messages[err.code] ?? 'Unknown GPS error. Please refresh and try again.');
    if (err.code === 1) stopBroadcasting(); // permission denied — stop immediately
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start / stop ──────────────────────────────────────────────────────────
  const startBroadcasting = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('GPS is not supported on this device or browser.');
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }
    setError(null);
    setStats(prev => ({
      ...prev,
      pointsSent: 0,
      sessionStarted: new Date(),
      lastSentAt: null,
      distanceTraveled: 0,
    }));
    lastSentRef.current = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      handleGPSError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
    setIsActive(true);
  }, [handlePosition, handleGPSError]);

  const stopBroadcasting = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastSentRef.current = null;
    setIsActive(false);
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
  }, []);

  // ── Derived display values ────────────────────────────────────────────────
  const sessionSecs = stats.sessionStarted
    ? Math.floor((Date.now() - stats.sessionStarted.getTime()) / 1000)
    : 0;
  const distKm = (stats.distanceTraveled / 1000).toFixed(2);

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {isActive && (
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
          )}
          <h3 className="text-sm font-semibold text-gray-900">
            {isActive ? 'Broadcasting Live Location' : 'GPS Location Broadcaster'}
          </h3>
        </div>
        {stats.batteryLevel !== null && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            stats.batteryLevel > 30 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            🔋 {stats.batteryLevel}%
          </span>
        )}
      </div>

      {/* ── Error Banner ────────────────────────────────────── */}
      {error && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <span className="shrink-0">⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* ── Toggle Button ───────────────────────────────────── */}
      <button
        type="button"
        onClick={isActive ? stopBroadcasting : startBroadcasting}
        className={`w-full rounded-xl px-6 py-3.5 text-sm font-semibold transition-all duration-200 ${
          isActive
            ? 'bg-red-500 text-white shadow-md hover:bg-red-600 active:scale-95'
            : 'bg-green-600 text-white shadow-md hover:bg-green-700 active:scale-95'
        }`}
      >
        {isActive ? '⏹ Stop Broadcasting Location' : '📡 Start Broadcasting Location'}
      </button>

      {/* ── Live Stats Grid ──────────────────────────────────── */}
      {isActive && (
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Latitude"    value={stats.currentLat?.toFixed(6)    ?? 'Getting…'} icon="🌐" />
          <StatCard label="Longitude"   value={stats.currentLng?.toFixed(6)    ?? 'Getting…'} icon="🌐" />
          <StatCard label="Accuracy"    value={stats.currentAccuracy != null ? `±${stats.currentAccuracy}m` : '—'} icon="🎯" />
          <StatCard label="Speed"       value={stats.currentSpeed != null ? `${stats.currentSpeed} km/h` : 'Stationary'} icon="💨" />
          <StatCard label="Direction"   value={headingToDirection(stats.currentHeading)} icon="🧭" />
          <StatCard label="Distance"    value={`${distKm} km`}                 icon="📏" />
          <StatCard label="Points Sent" value={String(stats.pointsSent)}        icon="📤" />
          <StatCard label="Last Sent"   value={secondsAgo(stats.lastSentAt)}    icon="🕐" />
          <StatCard
            label="Session"
            value={`${Math.floor(sessionSecs / 60)}m ${sessionSecs % 60}s`}
            icon="⏱"
          />
        </div>
      )}

      {/* ── Active warning ───────────────────────────────────── */}
      {isActive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>⚠️ Keep tab open</strong> — closing the browser or locking the screen will stop location updates.
          The renter sees your live position on their map.
        </div>
      )}

      {/* ── Idle hint ────────────────────────────────────────── */}
      {!isActive && !error && (
        <p className="text-center text-xs text-gray-400">
          Tap above to share your live location with the renter.
          Updates every 10–30 seconds automatically.
        </p>
      )}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] text-gray-500">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-0.5 truncate text-xs font-semibold text-gray-900">{value}</p>
    </div>
  );
}
