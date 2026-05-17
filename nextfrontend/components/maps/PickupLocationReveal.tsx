'use client';

/**
 * PickupLocationReveal — static map card shown to the renter
 * after booking is confirmed + payment is paid.
 *
 * Renders a Leaflet map with a blue marker + owner contact details.
 */

import dynamic from 'next/dynamic';
import { memo, useRef, useEffect } from 'react';
import { ExternalLink, Navigation, MapPin, Phone, User } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PickupRevealProps {
  lat:            number;
  lng:            number;
  address:        string;
  landmark?:      string;
  equipmentName:  string;
  ownerName?:     string;
  ownerPhone?:    string;
  bookingId?:     string;
  canTrack?:      boolean;   // show "Start Tracking" button
  onStartTracking?: () => void;
}

// ── Leaflet icon patch ────────────────────────────────────────────────────────

let _patched = false;
function patchLeafletIcons() {
  if (_patched) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require('leaflet');
  delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
  _patched = true;
}

// ── Size invalidate ───────────────────────────────────────────────────────────

const SizeWatcher = memo(function SizeWatcher() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require('react-leaflet');
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
});

// ── Map inner (Leaflet, client-only) ─────────────────────────────────────────

function MapInner({ lat, lng, equipmentName }: {
  lat: number; lng: number; equipmentName: string
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MapContainer, TileLayer, Marker, Popup } = require('react-leaflet');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require('leaflet');
  patchLeafletIcons();

  const bluePin = L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="
          width:32px;height:32px;border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          background:linear-gradient(135deg,#3b82f6,#1d4ed8);
          border:3px solid white;
          box-shadow:0 4px 12px rgba(59,130,246,0.55);
        "></div>
        <div style="width:2px;height:10px;background:#3b82f6;margin-top:-2px;"></div>
      </div>`,
    iconSize:   [32, 46],
    iconAnchor: [16, 46],
    className:  '',
  });

  const centerRef = useRef<[number, number]>([lat, lng]);

  return (
    <MapContainer
      center={centerRef.current}
      zoom={15}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={false}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      <SizeWatcher />
      <Marker position={[lat, lng]} icon={bluePin}>
        <Popup>
          <div className="text-center py-1">
            <p className="font-semibold text-sm">{equipmentName}</p>
            <p className="text-xs text-gray-500">Pickup Location</p>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}

const DynamicMap = dynamic(() => Promise.resolve(MapInner), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-gray-100 animate-pulse flex items-center justify-center">
      <MapPin className="h-6 w-6 text-gray-300" />
    </div>
  ),
});

// ── Mask phone number: show first 5 digits + **** ─────────────────────────────

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 5) return phone;
  return digits.slice(0, 5) + '****';
}

// ── Main exported component ───────────────────────────────────────────────────

export default function PickupLocationReveal({
  lat,
  lng,
  address,
  landmark,
  equipmentName,
  ownerName,
  ownerPhone,
  bookingId,
  canTrack = false,
  onStartTracking,
}: PickupRevealProps) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-white" />
        <span className="font-bold text-white text-sm">Pickup Location</span>
        <span className="ml-auto text-blue-200 text-xs">Confirmed ✓</span>
      </div>

      {/* Map */}
      <div
        className="h-[300px] w-full touch-none"
      >
        <DynamicMap lat={lat} lng={lng} equipmentName={equipmentName} />
      </div>

      {/* Details */}
      <div className="p-4 space-y-3">
        {/* Address */}
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-gray-800 leading-relaxed">{address}</p>
            {landmark && (
              <p className="text-xs text-gray-500 mt-0.5">📍 {landmark}</p>
            )}
          </div>
        </div>

        {/* Owner info */}
        {(ownerName || ownerPhone) && (
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
            {ownerName && (
              <div className="flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">{ownerName}</span>
              </div>
            )}
            {ownerPhone && (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-sm text-gray-600 font-mono">{maskPhone(ownerPhone)}</span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50"
            onClick={() => window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank', 'noopener')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in Maps
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-xs rounded-xl bg-blue-600 hover:bg-blue-700"
            onClick={() => window.open(`https://maps.google.com/maps?daddr=${lat},${lng}`, '_blank', 'noopener')}
          >
            <Navigation className="h-3.5 w-3.5" />
            Get Directions
          </Button>
        </div>

        {/* Start Tracking button — only when booking is active */}
        {canTrack && bookingId && (
          <Button
            type="button"
            className="w-full bg-green-700 hover:bg-green-800 rounded-xl gap-2 font-bold"
            onClick={onStartTracking}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-green-300 animate-pulse" />
            Start Live Tracking
          </Button>
        )}
      </div>
    </div>
  );
}
