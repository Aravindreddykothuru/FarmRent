'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, AlertTriangle, Navigation,
  Eye, EyeOff, Wifi, WifiOff, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { nodeApi } from '@/lib/api';
import { useEquipmentTracking } from '@/hooks/useEquipmentTracking';
import OwnerGPSBroadcaster from '@/components/tracking/OwnerGPSBroadcaster';

// ── Lazy-load map (Leaflet is client-only) ────────────────────────────────────

const TrackingMap = dynamic(() => import('@/components/maps/TrackingMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="text-5xl mb-3 animate-bounce">🚜</div>
        <p className="text-gray-500 text-sm">Loading map…</p>
      </div>
    </div>
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface Equipment {
  name:            string;
  images?:         string[];
  pickup_lat?:     number;
  pickup_lng?:     number;
  pickup_address?: string;
}

interface BookingInfo {
  id:           string;
  status:       string;
  equipment_id: string;
  farmer_id:    string;
  owner_id:     string;
  equipment?:   Equipment;
  owner?:       { name: string };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LiveTrackingPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router        = useRouter();

  const [booking,   setBooking]   = useState<BookingInfo | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [pageError, setPageError] = useState('');
  const [userId,    setUserId]    = useState('');
  const [userRole,  setUserRole]  = useState('');
  const [showPath,  setShowPath]  = useState(true);

  // ── Decode JWT for role / id ──────────────────────────────────────────────
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserRole(payload.role ?? '');
      setUserId(payload.id ?? payload.sub ?? '');
    } catch { /* malformed token — leave empty */ }
  }, []);

  // ── Fetch booking (Supabase first, nodeApi fallback) ─────────────────────
  const fetchBooking = useCallback(async () => {
    if (!bookingId) return;
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('bookings')
          .select(`
            id, status, equipment_id, farmer_id, owner_id,
            equipment:equipment_id ( name, images, pickup_lat, pickup_lng, pickup_address ),
            owner:owner_id ( name )
          `)
          .eq('id', bookingId)
          .single();

        if (!error && data) {
          setBooking(data as unknown as BookingInfo);
          return;
        }
      }
      // Fallback to Node.js backend
      const r  = await nodeApi.get<{ data?: BookingInfo }>(`/bookings/${bookingId}`);
      const bk = (r?.data ?? r) as BookingInfo;
      setBooking(bk);
    } catch {
      setPageError('Could not load booking details.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { fetchBooking(); }, [fetchBooking]);

  // ── Derived flags ─────────────────────────────────────────────────────────
  const isActive = ['confirmed', 'in_progress', 'active'].includes(booking?.status ?? '');
  const isOwner  = userRole === 'owner' && userId === booking?.owner_id;

  // ── Real-time tracking hook ───────────────────────────────────────────────
  const tracking = useEquipmentTracking({
    bookingId: bookingId ?? '',
    enabled:   !!booking && isActive,
  });

  // ── Derived map props ─────────────────────────────────────────────────────
  const eq          = booking?.equipment;
  const equipName   = eq?.name ?? 'Equipment';
  const pickupLocation: { lat: number; lng: number; address: string } =
    eq?.pickup_lat && eq?.pickup_lng
      ? { lat: eq.pickup_lat, lng: eq.pickup_lng, address: eq.pickup_address ?? '' }
      : { lat: 20.5937, lng: 78.9629, address: '' }; // fallback: centre of India

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!supabase) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
        <p className="font-bold text-gray-900 mb-2">Supabase Not Configured</p>
        <p className="text-sm text-gray-500">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable live tracking.
        </p>
      </div>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl animate-bounce mb-4">🚜</div>
        <Loader2 className="h-6 w-6 animate-spin text-green-700 mx-auto" />
      </div>
    </div>
  );

  if (pageError || !booking) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <AlertTriangle className="h-12 w-12 text-red-400" />
      <p className="text-gray-700">{pageError || 'Booking not found.'}</p>
      <button type="button" onClick={() => router.back()} className="text-green-700 underline text-sm">
        Go back
      </button>
    </div>
  );

  if (!isActive) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-gray-50">
      <div className="text-4xl">📍</div>
      <div className="max-w-sm rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center">
        <h2 className="mb-1 text-base font-semibold text-yellow-800">Tracking Not Available</h2>
        <p className="text-sm text-yellow-700">
          {{
            pending:   'Tracking will be available once the booking is confirmed and active.',
            confirmed: 'Tracking will be available once the equipment is handed over and rental begins.',
            returned:  'This rental has ended. View the location history below.',
          }[booking.status] ?? 'Tracking unavailable for this booking status.'}
        </p>
        <div className="mt-3 rounded-lg bg-yellow-100 px-3 py-2 text-xs font-medium text-yellow-800">
          Status: <span className="capitalize">{booking.status}</span>
        </div>
      </div>
      <button type="button" onClick={() => router.back()} className="text-green-700 underline text-sm">
        Go back
      </button>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-900">

      {/* ── Floating top bar ───────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-[500] px-4 pt-4 flex items-center gap-3 pointer-events-none">

        {/* Back */}
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="pointer-events-auto p-2.5 bg-white rounded-full shadow-lg hover:bg-gray-50"
        >
          <ArrowLeft className="h-5 w-5 text-gray-800" />
        </button>

        {/* Equipment name + connection badge */}
        <div className="pointer-events-auto flex-1 bg-white/95 backdrop-blur-sm rounded-2xl px-3 py-2 shadow-lg flex items-center justify-between gap-2">
          <span className="font-bold text-gray-900 text-sm truncate">{equipName}</span>

          <span className={`shrink-0 flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full ${
            tracking.connectionStatus === 'connected'
              ? 'bg-green-50 text-green-700'
              : tracking.connectionStatus === 'reconnecting'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-red-50 text-red-600'
          }`}>
            {tracking.connectionStatus === 'connected' ? (
              <><Wifi className="h-3 w-3" /> LIVE</>
            ) : tracking.connectionStatus === 'reconnecting' ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Reconnecting…</>
            ) : (
              <><WifiOff className="h-3 w-3" /> Connecting…</>
            )}
          </span>
        </div>

        {/* Show/hide trail */}
        <button
          type="button"
          onClick={() => setShowPath(v => !v)}
          aria-label={showPath ? 'Hide path' : 'Show path'}
          className="pointer-events-auto p-2.5 bg-white rounded-full shadow-lg hover:bg-gray-50"
          title={showPath ? 'Hide Path' : 'Show Path'}
        >
          {showPath
            ? <Eye    className="h-4 w-4 text-blue-600" />
            : <EyeOff className="h-4 w-4 text-gray-500" />}
        </button>
      </div>

      {/* ── Full-screen map ────────────────────────────────────────────── */}
      <div className="flex-1 relative touch-none">
        <TrackingMap
          currentLocation={tracking.currentLocation}
          locationHistory={tracking.locationHistory}
          showPath={showPath}
          pickupLocation={pickupLocation}
          equipmentName={equipName}
          isSignalLost={tracking.isSignalLost}
        />

        {/* Signal lost overlay */}
        {tracking.isSignalLost && tracking.currentLocation && (
          <div className="absolute top-16 left-4 right-4 z-[400] bg-red-500/90 backdrop-blur-sm rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg">
            <AlertTriangle className="h-4 w-4 text-white shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-bold">
                ⚠️ Signal lost — showing last known position (
                {Math.floor(tracking.secondsSinceUpdate / 60)}m{' '}
                {tracking.secondsSinceUpdate % 60}s ago)
              </p>
            </div>
          </div>
        )}

        {/* Waiting for first location */}
        {!tracking.currentLocation && !tracking.isSignalLost && (
          <div className="absolute top-16 left-4 right-4 z-[400] bg-blue-600/90 backdrop-blur-sm rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg">
            <Loader2 className="h-4 w-4 text-white animate-spin shrink-0" />
            <p className="text-white text-xs font-medium">
              Waiting for owner to start sharing location…
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom info panel ──────────────────────────────────────────── */}
      <div className="bg-white rounded-t-3xl shadow-2xl shrink-0 px-4 pb-6 pt-3 max-h-[45vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

        {/* Equipment header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-10 rounded-xl overflow-hidden bg-gray-100 shrink-0">
            {eq?.images?.[0] ? (
              <img src={eq.images[0]} alt={equipName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xl">🚜</div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate">{equipName}</p>
            {booking.owner && (
              <p className="text-xs text-gray-500">Owner: {booking.owner.name}</p>
            )}
          </div>
          <span className={`shrink-0 flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${
            tracking.isSignalLost
              ? 'bg-red-100 text-red-600'
              : tracking.currentLocation
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              tracking.isSignalLost
                ? 'bg-red-400'
                : tracking.currentLocation
                ? 'bg-green-400 animate-pulse'
                : 'bg-gray-300'
            }`} />
            {tracking.isSignalLost ? 'SIGNAL LOST' : tracking.currentLocation ? 'LIVE' : 'Waiting…'}
          </span>
        </div>

        {/* Stats grid */}
        {tracking.currentLocation && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <InfoBox label="Speed"     value={tracking.speedDisplay} />
            <InfoBox label="Direction" value={tracking.directionDisplay} />
            <InfoBox label="Accuracy"  value={tracking.accuracyDisplay} />
            <InfoBox
              label="Last Update"
              value={`${tracking.secondsSinceUpdate}s ago`}
              highlight={tracking.secondsSinceUpdate > 60}
            />
            <InfoBox
              label="Distance Traveled"
              value={tracking.distanceDisplay}
              className="col-span-2"
            />
          </div>
        )}

        {/* No location yet */}
        {!tracking.currentLocation && !tracking.isSignalLost && (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-2 justify-center mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for first location update…
          </div>
        )}

        {/* Open in Google Maps */}
        {tracking.currentLocation && (
          <button
            type="button"
            onClick={() =>
              window.open(
                `https://maps.google.com/?q=${tracking.currentLocation!.lat},${tracking.currentLocation!.lng}`,
                '_blank',
              )
            }
            className="w-full mb-3 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🗺️ Open in Google Maps
          </button>
        )}

        {/* Owner GPS Broadcaster */}
        {isOwner && booking.equipment_id && (
          <div className="mb-3">
            <OwnerGPSBroadcaster
              bookingId={bookingId ?? ''}
              equipmentId={booking.equipment_id}
            />
          </div>
        )}

        {/* Location history link */}
        <button
          type="button"
          onClick={() => router.push(`/dashboard/bookings/${bookingId}/location-history`)}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
        >
          <Navigation className="h-4 w-4" />
          View Location History
        </button>
      </div>
    </div>
  );
}

// ── Info box ──────────────────────────────────────────────────────────────────

function InfoBox({
  label, value, highlight = false, className = '',
}: {
  label: string; value: string; highlight?: boolean; className?: string;
}) {
  return (
    <div className={`bg-gray-50 rounded-xl p-3 ${className}`}>
      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`font-bold text-sm ${highlight ? 'text-amber-600' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}
