"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { useEquipmentTracking } from "@/hooks/useEquipmentTracking";
import type { LocationPoint } from "@/hooks/useEquipmentTracking";

// ─── Leaflet loaded client-side only (no SSR) ─────────────────────────────────
const TrackingMap = dynamic(() => import("@/components/maps/TrackingMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-gray-100 text-gray-500 text-sm">
      🗺️ Loading map...
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingDetail {
  id: string;
  status: "pending" | "confirmed" | "active" | "returned";
  renter_id: string;
  equipment: {
    id: string;
    name: string;
    photo_url: string | null;
    pickup_lat: number;
    pickup_lng: number;
    pickup_address: string;
  };
  owner: {
    full_name: string;
    phone: string;
  };
}

// ─── Main Page Component ───────────────────────────────────────────────────────

export default function RenterTrackingPage({
  params,
}: {
  params: { bookingId: string };
}) {
  const { bookingId } = params;
  const supabase = createClientComponentClient();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [showPath, setShowPath] = useState(true);

  // ── Fetch booking details ────────────────────────────────────────────────
  useEffect(() => {
    async function fetchBooking() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setAccessError("You must be logged in to view tracking.");
        setLoadingBooking(false);
        return;
      }

      const { data, error } = await supabase
        .from("bookings")
        .select(`
          id, status, renter_id,
          equipment:equipment_id (
            id, name, photo_url,
            pickup_lat, pickup_lng, pickup_address
          ),
          owner:owner_id (
            full_name, phone
          )
        `)
        .eq("id", bookingId)
        .eq("renter_id", user.id) // RLS: only renter can access
        .single();

      if (error || !data) {
        setAccessError("Booking not found or you don't have access to this tracking page.");
        setLoadingBooking(false);
        return;
      }

      setBooking(data as unknown as BookingDetail);
      setLoadingBooking(false);
    }

    fetchBooking();
  }, [bookingId, supabase]);

  // ── GPS Tracking Hook ────────────────────────────────────────────────────
  const tracking = useEquipmentTracking({
    bookingId,
    enabled: booking?.status === "active",
    signalLostThresholdMs: 3 * 60 * 1000,
    maxHistoryPoints: 500,
  });

  // ─── Loading / Error / Guard States ──────────────────────────────────────

  if (loadingBooking) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading tracking...</p>
        </div>
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <div className="mb-2 text-4xl">🔒</div>
          <h2 className="mb-1 text-lg font-semibold text-red-800">Access Denied</h2>
          <p className="text-sm text-red-600">{accessError}</p>
        </div>
      </div>
    );
  }

  if (!booking) return null;

  // Guard: Only active bookings can be tracked
  if (booking.status !== "active") {
    const statusMessages: Record<string, string> = {
      pending: "Tracking will be available once the booking is confirmed and active.",
      confirmed: "Tracking will be available once the equipment is handed over and rental begins.",
      returned: "This rental has ended. View the location history below.",
    };

    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-center">
          <div className="mb-2 text-4xl">📍</div>
          <h2 className="mb-1 text-lg font-semibold text-yellow-800">
            Tracking Not Available
          </h2>
          <p className="text-sm text-yellow-700">
            {statusMessages[booking.status] ?? "Tracking unavailable for this booking status."}
          </p>
          <div className="mt-3 rounded-lg bg-yellow-100 px-3 py-2 text-xs font-medium text-yellow-800">
            Current Status: <span className="capitalize">{booking.status}</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Mask phone number ───────────────────────────────────────────────────
  const maskedPhone = booking.owner.phone
    ? booking.owner.phone.slice(0, 5) + "XXXXX"
    : "—";

  return (
    <div className="flex h-screen flex-col bg-gray-900">

      {/* ── Top Bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-gray-900 px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          {booking.equipment.photo_url && (
            <img
              src={booking.equipment.photo_url}
              alt={booking.equipment.name}
              className="h-9 w-9 rounded-lg object-cover"
            />
          )}
          <div>
            <p className="text-sm font-semibold">{booking.equipment.name}</p>
            <p className="text-xs text-gray-400">Owner: {booking.owner.full_name}</p>
          </div>
        </div>

        {/* Connection Status Badge */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            tracking.connectionStatus === "connected"
              ? "bg-green-900 text-green-300"
              : tracking.connectionStatus === "reconnecting"
              ? "bg-yellow-900 text-yellow-300"
              : "bg-gray-700 text-gray-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              tracking.connectionStatus === "connected"
                ? "bg-green-400"
                : tracking.connectionStatus === "reconnecting"
                ? "animate-pulse bg-yellow-400"
                : "bg-gray-400"
            }`}
          />
          {tracking.connectionStatus === "connected"
            ? "LIVE"
            : tracking.connectionStatus === "reconnecting"
            ? "Reconnecting..."
            : "Connecting..."}
        </div>
      </div>

      {/* ── Signal Lost Banner ─────────────────────────────────────────── */}
      {tracking.isSignalLost && tracking.currentLocation && (
        <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-medium text-white">
          <span className="animate-pulse">⚠️</span>
          Location signal lost. Showing last known position (
          {Math.floor(tracking.secondsSinceUpdate / 60)}m{" "}
          {tracking.secondsSinceUpdate % 60}s ago).
        </div>
      )}

      {/* ── No Location Yet Banner ─────────────────────────────────────── */}
      {!tracking.currentLocation && !tracking.isSignalLost && (
        <div className="flex items-center gap-2 bg-blue-600 px-4 py-2 text-xs font-medium text-white">
          <span className="animate-spin">⏳</span>
          Waiting for owner to start sharing location...
        </div>
      )}

      {/* ── Map ───────────────────────────────────────────────────────── */}
      <div className="relative flex-1">
        <TrackingMap
          currentLocation={tracking.currentLocation}
          locationHistory={tracking.locationHistory}
          showPath={showPath}
          pickupLocation={{
            lat: booking.equipment.pickup_lat,
            lng: booking.equipment.pickup_lng,
            address: booking.equipment.pickup_address,
          }}
          equipmentName={booking.equipment.name}
          isSignalLost={tracking.isSignalLost}
        />

        {/* Map Controls */}
        <div className="absolute right-3 top-3 flex flex-col gap-2">
          <button
            onClick={() => setShowPath((v) => !v)}
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-md hover:bg-gray-50"
          >
            {showPath ? "Hide Path" : "Show Path"}
          </button>
        </div>
      </div>

      {/* ── Bottom Info Panel ──────────────────────────────────────────── */}
      <div className="bg-gray-900 px-4 pb-safe pt-3 text-white">
        <div className="grid grid-cols-4 gap-2 pb-4">
          <InfoChip
            icon="💨"
            label="Speed"
            value={tracking.speedDisplay}
          />
          <InfoChip
            icon="🧭"
            label="Direction"
            value={tracking.directionDisplay}
          />
          <InfoChip
            icon="🎯"
            label="Accuracy"
            value={tracking.accuracyDisplay}
          />
          <InfoChip
            icon="📏"
            label="Distance"
            value={tracking.distanceDisplay}
          />
        </div>

        {/* Last Update */}
        {tracking.lastUpdateAt && (
          <p className="pb-2 text-center text-xs text-gray-500">
            Last updated{" "}
            <span className="text-gray-300">
              {tracking.secondsSinceUpdate}s ago
            </span>
            {" · "}
            Owner: {maskedPhone}
          </p>
        )}

        {/* Open in Google Maps */}
        {tracking.currentLocation && (
          <button
            onClick={() =>
              window.open(
                `https://maps.google.com/?q=${tracking.currentLocation!.lat},${tracking.currentLocation!.lng}`,
                "_blank"
              )
            }
            className="mb-3 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🗺️ Open in Google Maps
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Info Chip ────────────────────────────────────────────────────────────────

function InfoChip({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-gray-800 px-2 py-2 text-center">
      <div className="text-base">{icon}</div>
      <div className="mt-0.5 text-xs font-semibold text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}
