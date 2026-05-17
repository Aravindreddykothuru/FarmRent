'use client';

// Loaded via dynamic import with { ssr: false } ONLY — never import directly in a server component.

import { useEffect, useRef } from 'react';
import type { LocationPoint } from '@/hooks/useEquipmentTracking';

interface TrackingMapProps {
  currentLocation:  LocationPoint | null;
  locationHistory:  LocationPoint[];
  showPath:         boolean;
  pickupLocation:   { lat: number; lng: number; address: string };
  equipmentName:    string;
  isSignalLost:     boolean;
}

// ── Icon HTML builders ────────────────────────────────────────────────────────

function tractorIconHtml(signalLost: boolean) {
  return `
    <div style="
      display:flex;align-items:center;justify-content:center;
      width:40px;height:40px;
      background:${signalLost ? '#9CA3AF' : '#16A34A'};
      border-radius:50%;border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      font-size:20px;
      transition:background 0.4s;
    ">🚜</div>`;
}

function pickupIconHtml() {
  return `
    <div style="
      display:flex;align-items:center;justify-content:center;
      width:36px;height:36px;
      background:#2563EB;border-radius:50%;border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:18px;
    ">📍</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TrackingMap({
  currentLocation,
  locationHistory,
  showPath,
  pickupLocation,
  equipmentName,
  isSignalLost,
}: TrackingMapProps) {
  const containerRef        = useRef<HTMLDivElement>(null);
  const mapRef              = useRef<unknown>(null);
  const equipmentMarkerRef  = useRef<unknown>(null);
  const accuracyCircleRef   = useRef<unknown>(null);
  const pickupMarkerRef     = useRef<unknown>(null);
  const pathPolylineRef     = useRef<unknown>(null);
  const initializedRef      = useRef(false);

  // ── Initialise map (once on mount) ────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;

    async function init() {
      const L = (await import('leaflet')).default;

      // Fix Next.js default icon path bug
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const center: [number, number] = currentLocation
        ? [currentLocation.lat, currentLocation.lng]
        : [pickupLocation.lat, pickupLocation.lng];

      const map = L.map(containerRef.current!, {
        center,
        zoom:               15,
        zoomControl:        true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Pickup marker
      const pickupIcon = L.divIcon({
        html:       pickupIconHtml(),
        className:  '',
        iconSize:   [36, 36],
        iconAnchor: [18, 18],
        popupAnchor:[0, -22],
      });
      const pickupMarker = L.marker([pickupLocation.lat, pickupLocation.lng], { icon: pickupIcon })
        .addTo(map)
        .bindPopup(`<div style="font-size:13px;"><strong>Pickup Location</strong><br/>${pickupLocation.address}</div>`);
      pickupMarkerRef.current = pickupMarker;

      // Equipment marker (if we already have a location on mount)
      if (currentLocation) {
        const icon = L.divIcon({
          html:       tractorIconHtml(isSignalLost),
          className:  '',
          iconSize:   [40, 40],
          iconAnchor: [20, 20],
          popupAnchor:[0, -24],
        });
        const marker = L.marker([currentLocation.lat, currentLocation.lng], { icon })
          .addTo(map)
          .bindPopup(`<div style="font-size:13px;"><strong>${equipmentName}</strong><br/>📡 Live Location</div>`);
        equipmentMarkerRef.current = marker;

        if (currentLocation.accuracy) {
          const circle = L.circle([currentLocation.lat, currentLocation.lng], {
            radius:      currentLocation.accuracy,
            color:       '#16A34A',
            fillColor:   '#16A34A',
            fillOpacity: 0.08,
            weight:      1,
          }).addTo(map);
          accuracyCircleRef.current = circle;
        }
      }

      // Path polyline — added only when showPath is true initially
      const polyline = L.polyline([], {
        color:     '#3B82F6',
        weight:    3,
        opacity:   0.65,
        dashArray: '6, 4',
      });
      if (showPath) polyline.addTo(map);
      pathPolylineRef.current = polyline;

      mapRef.current     = map;
      initializedRef.current = true;
    }

    init();

    return () => {
      const m = mapRef.current as { remove?: () => void } | null;
      if (m?.remove) {
        m.remove();
        mapRef.current     = null;
        initializedRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once — subsequent prop changes handled below

  // ── Update equipment marker when currentLocation changes ──────────────────
  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;

    async function updateMarker() {
      const L      = (await import('leaflet')).default;
      const map    = mapRef.current as { panTo: (ll: unknown, opts: unknown) => void };
      const newLL  = L.latLng(currentLocation!.lat, currentLocation!.lng);

      const icon = L.divIcon({
        html:       tractorIconHtml(isSignalLost),
        className:  '',
        iconSize:   [40, 40],
        iconAnchor: [20, 20],
        popupAnchor:[0, -24],
      });

      if (!equipmentMarkerRef.current) {
        const marker = L.marker(newLL, { icon })
          .addTo(mapRef.current as unknown as L.Map)
          .bindPopup(`<strong>${equipmentName}</strong><br/>📡 Live Location`);
        equipmentMarkerRef.current = marker;
      } else {
        const m = equipmentMarkerRef.current as { setLatLng: (ll: unknown) => void; setIcon: (i: unknown) => void };
        m.setLatLng(newLL);
        m.setIcon(icon);
      }

      // Accuracy circle
      if (currentLocation!.accuracy) {
        if (!accuracyCircleRef.current) {
          const circle = L.circle(newLL, {
            radius:      currentLocation!.accuracy,
            color:       '#16A34A',
            fillColor:   '#16A34A',
            fillOpacity: 0.08,
            weight:      1,
          }).addTo(mapRef.current as unknown as L.Map);
          accuracyCircleRef.current = circle;
        } else {
          const c = accuracyCircleRef.current as { setLatLng: (ll: unknown) => void; setRadius: (r: number) => void };
          c.setLatLng(newLL);
          c.setRadius(currentLocation!.accuracy);
        }
      }

      map.panTo(newLL, { animate: true, duration: 0.8 });
    }

    updateMarker();
  }, [currentLocation, equipmentName, isSignalLost]);

  // ── Update signal-lost marker colour ──────────────────────────────────────
  useEffect(() => {
    if (!equipmentMarkerRef.current) return;

    async function updateIcon() {
      const L    = (await import('leaflet')).default;
      const icon = L.divIcon({
        html:       tractorIconHtml(isSignalLost),
        className:  '',
        iconSize:   [40, 40],
        iconAnchor: [20, 20],
        popupAnchor:[0, -24],
      });
      const m = equipmentMarkerRef.current as { setIcon: (i: unknown) => void } | null;
      m?.setIcon(icon);
    }

    updateIcon();
  }, [isSignalLost]);

  // ── Update path polyline latlngs (always, even when hidden) ──────────────
  useEffect(() => {
    const poly = pathPolylineRef.current as { setLatLngs: (ll: [number, number][]) => void } | null;
    if (!poly) return;
    const latlngs = locationHistory.map((p): [number, number] => [p.lat, p.lng]);
    poly.setLatLngs(latlngs);
  }, [locationHistory]);

  // ── Show / hide path (separate from latlng updates) ───────────────────────
  useEffect(() => {
    const poly = pathPolylineRef.current as { addTo: (m: unknown) => void; remove: () => void } | null;
    if (!poly || !mapRef.current) return;
    if (showPath) {
      poly.addTo(mapRef.current);
    } else {
      poly.remove();
    }
  }, [showPath]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full touch-none"
    />
  );
}
