'use client';

/**
 * PickupLocationPicker — draggable red-pin map for equipment pickup location.
 * Used in the "List Equipment" form.
 *
 * Emits: { lat, lng, address, landmark } to parent on every change.
 * Validation: parent must reject submit when lat/lng are null.
 */

import dynamic from 'next/dynamic';
import { Crosshair, Loader2, MapPin } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PickupResult {
  lat:      number;
  lng:      number;
  address:  string;
  landmark: string;
}

interface Props {
  onChange:       (result: PickupResult | null) => void;
  initialLat?:    number;
  initialLng?:    number;
  initialAddress?: string;
  initialLandmark?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INDIA_CENTER: [number, number] = [20.5937, 78.9629];

// ── Nominatim reverse-geocode ─────────────────────────────────────────────────

async function reverseGeocode(
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  const res  = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
  const data = await res.json().catch(() => null);
  return (data?.display_name as string) ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

// ── Stable sub-components (module-level to avoid remount on parent re-render) ─

const MapClickHandler = memo(function MapClickHandler({
  onMapClick,
}: { onMapClick: (lat: number, lng: number) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMapEvents } = require('react-leaflet');
  const cbRef = useRef(onMapClick);
  cbRef.current = onMapClick;
  useMapEvents({
    click(e: { latlng: { lat: number; lng: number } }) {
      cbRef.current(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
});

const FlyToHandler = memo(function FlyToHandler({
  target,
}: { target: [number, number] | null }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require('react-leaflet');
  const map     = useMap();
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const key = `${target[0]},${target[1]}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    map.flyTo(target, 15, { duration: 1.2, easeLinearity: 0.4 });
  });
  return null;
});

const SizeWatcher = memo(function SizeWatcher() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require('react-leaflet');
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 60);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
});

// ── Inner (client-only) component ─────────────────────────────────────────────

function PickerInner({ onChange, initialLat, initialLng, initialAddress, initialLandmark }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MapContainer, TileLayer, Marker, useMapEvents: _u } = require('react-leaflet');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require('leaflet');
  patchLeafletIcons();

  const hasInitial = initialLat != null && initialLng != null;

  const initialCenter = useRef<[number, number]>(
    hasInitial ? [initialLat!, initialLng!] : INDIA_CENTER,
  );
  const initialZoom = useRef<number>(hasInitial ? 15 : 5);

  const [markerPos,  setMarkerPos]  = useState<[number, number] | null>(
    hasInitial ? [initialLat!, initialLng!] : null,
  );
  const [flyTarget,  setFlyTarget]  = useState<[number, number] | null>(null);
  const [address,    setAddress]    = useState(initialAddress ?? '');
  const [landmark,   setLandmark]   = useState(initialLandmark ?? '');
  const [geocoding,  setGeocoding]  = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [geoError,   setGeoError]   = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const latestId = useRef(0);

  // ── Emit to parent on any change ───────────────────────────────────────────
  const emitChange = useCallback(
    (pos: [number, number] | null, addr: string, lm: string) => {
      if (!pos) { onChange(null); return; }
      onChange({ lat: pos[0], lng: pos[1], address: addr, landmark: lm });
    },
    [onChange],
  );

  // ── Reverse-geocode a position ─────────────────────────────────────────────
  const applyPosition = useCallback(
    async (lat: number, lng: number) => {
      const pos: [number, number] = [lat, lng];
      setMarkerPos(pos);
      setGeocoding(true);
      setGeoError('');

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const reqId = ++latestId.current;

      try {
        const resolved = await reverseGeocode(lat, lng, ctrl.signal);
        if (latestId.current !== reqId) return;
        setAddress(resolved);
        emitChange(pos, resolved, landmark);
      } catch {
        if (ctrl.signal.aborted) return;
        const fallback = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        setAddress(fallback);
        emitChange(pos, fallback, landmark);
      } finally {
        if (latestId.current === reqId) setGeocoding(false);
      }
    },
    [emitChange, landmark],
  );

  // ── Marker drag end ────────────────────────────────────────────────────────
  const markerRef = useRef<{ getLatLng: () => { lat: number; lng: number } } | null>(null);

  // ── Browser GPS auto-locate ────────────────────────────────────────────────
  const handleGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => {
        setGpsLoading(false);
        setFlyTarget([latitude, longitude]);
        void applyPosition(latitude, longitude);
      },
      (err) => {
        setGpsLoading(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access denied. Please allow location in browser settings.'
            : 'Could not get GPS position. Try again.',
        );
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }, [applyPosition]);

  // ── Map click ──────────────────────────────────────────────────────────────
  const handleMapClick = useCallback(
    (lat: number, lng: number) => void applyPosition(lat, lng),
    [applyPosition],
  );

  // ── Landmark changes ───────────────────────────────────────────────────────
  const handleLandmarkChange = useCallback(
    (lm: string) => {
      setLandmark(lm);
      if (markerPos) emitChange(markerPos, address, lm);
    },
    [markerPos, address, emitChange],
  );

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => () => abortRef.current?.abort(), []);

  // ── Red draggable icon ─────────────────────────────────────────────────────
  const redPin = L.divIcon({
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;cursor:grab;">
        <div style="
          width:32px;height:32px;border-radius:50% 50% 50% 0;
          transform:rotate(-45deg);
          background:linear-gradient(135deg,#ef4444,#b91c1c);
          border:3px solid white;
          box-shadow:0 4px 12px rgba(239,68,68,0.55);
        "></div>
        <div style="width:2px;height:10px;background:#ef4444;margin-top:-2px;"></div>
      </div>`,
    iconSize:   [32, 46],
    iconAnchor: [16, 46],
    className:  '',
  });

  return (
    <div className="flex flex-col gap-3">

      {/* ── GPS auto-locate row ─────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleGPS}
          disabled={gpsLoading}
          className="h-9 px-3 rounded-xl gap-2 text-sm"
        >
          {gpsLoading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Crosshair className="h-3.5 w-3.5 text-green-700" />}
          Use My Location
        </Button>
        <p className="text-xs text-gray-400">or click/drag the pin on the map</p>
      </div>

      {/* ── Error strip ────────────────────────────────────────── */}
      {geoError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {geoError}
        </p>
      )}

      {/* ── Map ────────────────────────────────────────────────── */}
      <div
        className="h-64 w-full shrink-0 rounded-xl overflow-hidden border border-gray-200 shadow-sm"
        style={{ touchAction: 'none' }}
      >
        <MapContainer
          center={initialCenter.current}
          zoom={initialZoom.current}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="© OpenStreetMap contributors"
          />
          <SizeWatcher />
          <MapClickHandler onMapClick={handleMapClick} />
          <FlyToHandler target={flyTarget} />

          {markerPos && (
            <Marker
              position={markerPos}
              icon={redPin}
              draggable={true}
              ref={markerRef}
              eventHandlers={{
                dragend(e: { target: unknown }) {
                  const m = e.target as { getLatLng: () => { lat: number; lng: number } };
                  const { lat, lng } = m.getLatLng();
                  void applyPosition(lat, lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      {/* ── Resolved address display ────────────────────────────── */}
      <div className="min-h-[36px] flex items-start">
        {geocoding ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 py-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Resolving address…</span>
          </div>
        ) : address ? (
          <div className="flex items-start gap-1.5 w-full text-xs text-gray-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-2">
            <MapPin className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
            <span className="leading-relaxed">{address}</span>
          </div>
        ) : (
          <p className="text-xs text-gray-400 py-1 italic">
            Click on the map to pin the exact pickup point
          </p>
        )}
      </div>

      {/* ── Landmark / manual address input ─────────────────────── */}
      <div>
        <Label htmlFor="pickup-landmark" className="mb-1.5 block text-sm font-medium">
          Landmark / Address Details
          <span className="text-gray-400 font-normal ml-1">(optional but helpful)</span>
        </Label>
        <Input
          id="pickup-landmark"
          placeholder="e.g. Near Amangal bus stand, behind petrol pump"
          value={landmark}
          onChange={e => handleLandmarkChange(e.target.value)}
          className="text-sm"
        />
      </div>

      {/* ── Hint when no pin placed ─────────────────────────────── */}
      {!markerPos && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          Pickup location not set. Click the map to place the red pin.
        </p>
      )}
    </div>
  );
}

// ── Dynamic wrapper — SSR safe ────────────────────────────────────────────────

const DynamicPicker = dynamic(() => Promise.resolve(PickerInner), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-3">
      <div className="h-9 w-44 rounded-xl bg-gray-100 animate-pulse" />
      <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
      <div className="h-9 rounded-xl bg-gray-100 animate-pulse" />
      <div className="h-9 rounded-xl bg-gray-100 animate-pulse" />
    </div>
  ),
});

export default function PickupLocationPicker(props: Props) {
  return <DynamicPicker {...props} />;
}
