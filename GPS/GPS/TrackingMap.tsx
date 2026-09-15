"use client";

// ⚠️ This file is loaded via dynamic import with { ssr: false } ONLY.
// Never import this directly in a server component or _app.tsx.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";

// Inline type — mirrors the export in hooks/useEquipmentTracking.ts
export interface LocationPoint {
  lat:        number;
  lng:        number;
  accuracy:   number | null;
  speed:      number | null;
  heading:    number | null;
  altitude:   number | null;
  updated_at: string;
}

// Leaflet CSS must be imported once globally in your layout or _app
// Add this to your global CSS or layout.tsx:
// import "leaflet/dist/leaflet.css";

interface TrackingMapProps {
  currentLocation: LocationPoint | null;
  locationHistory: LocationPoint[];
  showPath: boolean;
  pickupLocation: {
    lat: number;
    lng: number;
    address: string;
  };
  equipmentName: string;
  isSignalLost: boolean;
}

export default function TrackingMap({
  currentLocation,
  locationHistory,
  showPath,
  pickupLocation,
  equipmentName,
  isSignalLost,
}: TrackingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Leaflet instances stored in refs (not state) to avoid re-renders
  const mapRef = useRef<any>(null);
  const equipmentMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const pathPolylineRef = useRef<any>(null);
  const isInitializedRef = useRef(false);

  // ── Initialize Leaflet Map (runs once) ──────────────────────────────────
  useEffect(() => {
    if (isInitializedRef.current || !mapContainerRef.current) return;

    async function initMap() {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — leaflet is installed in nextfrontend/node_modules
      const L = (await import("leaflet")).default;

      // Fix default marker icon path issue in Next.js
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
        iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
      });

      const initialCenter: [number, number] = currentLocation
        ? [currentLocation.lat, currentLocation.lng]
        : [pickupLocation.lat, pickupLocation.lng];

      const map = L.map(mapContainerRef.current!, {
        center: initialCenter,
        zoom: 15,
        zoomControl: true,
        attributionControl: false,
      });

      // Tile layer (OpenStreetMap)
      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19 }
      ).addTo(map);

      // ── Equipment Marker (Tractor emoji as custom icon) ────────────────
      const tractorIcon = L.divIcon({
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            background: ${isSignalLost ? "#9CA3AF" : "#16A34A"};
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-size: 20px;
            transition: background 0.3s;
          ">
            🚜
          </div>
        `,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -24],
      });

      // ── Pickup Location Marker (Blue flag) ────────────────────────────
      const pickupIcon = L.divIcon({
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            background: #2563EB;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-size: 18px;
          ">
            📍
          </div>
        `,
        className: "",
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -22],
      });

      // Add pickup marker
      const pickupMarker = L.marker(
        [pickupLocation.lat, pickupLocation.lng],
        { icon: pickupIcon }
      )
        .addTo(map)
        .bindPopup(`
          <div style="font-size:13px;">
            <strong>Pickup Location</strong><br/>
            ${pickupLocation.address}
          </div>
        `);

      pickupMarkerRef.current = pickupMarker;

      // Add equipment marker (if we already have a location)
      if (currentLocation) {
        const marker = L.marker(
          [currentLocation.lat, currentLocation.lng],
          { icon: tractorIcon }
        )
          .addTo(map)
          .bindPopup(`
            <div style="font-size:13px;">
              <strong>${equipmentName}</strong><br/>
              📡 Live Location
            </div>
          `);

        equipmentMarkerRef.current = marker;

        // Accuracy circle
        if (currentLocation.accuracy) {
          const circle = L.circle(
            [currentLocation.lat, currentLocation.lng],
            {
              radius: currentLocation.accuracy,
              color: "#16A34A",
              fillColor: "#16A34A",
              fillOpacity: 0.08,
              weight: 1,
            }
          ).addTo(map);
          accuracyCircleRef.current = circle;
        }
      }

      // Path polyline (empty initially)
      const polyline = L.polyline([], {
        color: "#3B82F6",
        weight: 3,
        opacity: 0.65,
        dashArray: "6, 4",
      }).addTo(map);

      pathPolylineRef.current = polyline;
      mapRef.current = map;
      isInitializedRef.current = true;
    }

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        isInitializedRef.current = false;
      }
    };
  }, []); // Only runs on mount

  // ── Update marker position when currentLocation changes ────────────────────
  useEffect(() => {
    if (!mapRef.current || !currentLocation) return;

    async function updateMarker() {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — leaflet is installed in nextfrontend/node_modules
      const L = (await import("leaflet")).default;
      const newLatLng = L.latLng(currentLocation!.lat, currentLocation!.lng);

      if (!equipmentMarkerRef.current) {
        // First location received — create marker now
        const tractorIcon = L.divIcon({
          html: `
            <div style="
              display: flex;
              align-items: center;
              justify-content: center;
              width: 40px;
              height: 40px;
              background: ${isSignalLost ? "#9CA3AF" : "#16A34A"};
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              font-size: 20px;
            ">🚜</div>
          `,
          className: "",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
          popupAnchor: [0, -24],
        });

        const marker = L.marker(newLatLng, { icon: tractorIcon })
          .addTo(mapRef.current)
          .bindPopup(`<strong>${equipmentName}</strong><br/>📡 Live Location`);

        equipmentMarkerRef.current = marker;
      } else {
        // Smooth update — just move the existing marker
        equipmentMarkerRef.current.setLatLng(newLatLng);
      }

      // Update accuracy circle
      if (currentLocation!.accuracy) {
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = L.circle(newLatLng, {
            radius: currentLocation!.accuracy,
            color: "#16A34A",
            fillColor: "#16A34A",
            fillOpacity: 0.08,
            weight: 1,
          }).addTo(mapRef.current);
        } else {
          accuracyCircleRef.current.setLatLng(newLatLng);
          accuracyCircleRef.current.setRadius(currentLocation!.accuracy);
        }
      }

      // Smoothly pan map to follow the marker
      mapRef.current.panTo(newLatLng, { animate: true, duration: 0.8 });
    }

    updateMarker();
  }, [currentLocation, equipmentName, isSignalLost]);

  // ── Update path polyline when history changes ──────────────────────────────
  useEffect(() => {
    if (!pathPolylineRef.current || !showPath) return;

    const latlngs = locationHistory.map((p) => [p.lat, p.lng] as [number, number]);
    pathPolylineRef.current.setLatLngs(latlngs);
  }, [locationHistory, showPath]);

  // ── Show/hide path ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pathPolylineRef.current || !mapRef.current) return;
    if (showPath) {
      pathPolylineRef.current.addTo(mapRef.current);
    } else {
      pathPolylineRef.current.remove();
    }
  }, [showPath]);

  // ── Update marker colour when signal is lost / restored ───────────────────
  useEffect(() => {
    if (!equipmentMarkerRef.current) return;

    async function updateIcon() {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — leaflet is installed in nextfrontend/node_modules
      const L = (await import("leaflet")).default;
      const icon = L.divIcon({
        html: `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            background: ${isSignalLost ? "#9CA3AF" : "#16A34A"};
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            font-size: 20px;
            transition: background 0.4s;
          ">🚜</div>
        `,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -24],
      });
      equipmentMarkerRef.current?.setIcon(icon);
    }

    updateIcon();
  }, [isSignalLost]);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full touch-none"
    />
  );
}
