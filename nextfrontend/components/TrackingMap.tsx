'use client';

/**
 * TrackingMap.tsx — Production real-time GPS map
 *
 * Features:
 *  • Smooth driver marker animation between GPS ticks (CSS transition + Leaflet panTo)
 *  • Heading-based icon rotation (truck faces direction of travel)
 *  • Live breadcrumb trail (last 100 points, fades older ones)
 *  • OSRM route polyline (updates on driver movement)
 *  • Recenter button (auto-pan to driver or pickup)
 *  • GPS signal quality badge
 *  • Lazy-loaded (no SSR) to avoid Leaflet window issues
 */

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useBookingSocket } from '../hooks/useBookingSocket';
import { MAP_COLORS } from '@/lib/mapColors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RouteGeometry {
    type: string;
    coordinates: [number, number][];
}

interface Props {
    deliveryId?:    string;
    bookingId?:     string;
    initialLat?:    number;
    initialLng?:    number;
    pickupLat?:     number;
    pickupLng?:     number;
    dropoffLat?:    number;
    dropoffLng?:    number;
    routeGeometry?: RouteGeometry | null;
}

// ── Inner map (client-only) ───────────────────────────────────────────────────

function MapInner({
    position, positions, heading,
    routeGeometry, liveRoute,
    pickupLat, pickupLng, dropoffLat, dropoffLng,
    onRecenter: _onRecenter, shouldRecenter, speed,
}: {
    position:      [number, number];
    positions:     [number, number][];
    heading:       number;
    routeGeometry: RouteGeometry | null;
    liveRoute:     RouteGeometry | null;
    pickupLat?:    number;
    pickupLng?:    number;
    dropoffLat?:   number;
    dropoffLng?:   number;
    onRecenter:    () => void;
    shouldRecenter: boolean;
    speed:          number;
}) {
     
    const { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } = require('react-leaflet');
     
    const L = require('leaflet');

    // ── Custom icons ────────────────────────────────────────────────────────

    const truckIcon = L.divIcon({
        html: `
            <div style="
                width:44px; height:44px; display:flex; align-items:center; justify-content:center;
                transform: rotate(${heading}deg);
                transition: transform 0.4s ease;
                filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35));
            ">
                <div style="
                    background: linear-gradient(135deg, ${MAP_COLORS.PIN_GREEN_START}, ${MAP_COLORS.PIN_GREEN_END});
                    border-radius: 50%; width:38px; height:38px;
                    display:flex; align-items:center; justify-content:center;
                    border: 3px solid white; font-size:18px; line-height:1;
                ">🚜</div>
            </div>`,
        iconSize:   [44, 44],
        iconAnchor: [22, 22],
        className:  '',
    });

    const pickupIcon = L.divIcon({
        html: `
            <div style="display:flex; flex-direction:column; align-items:center;">
                <div style="
                    background: linear-gradient(135deg, ${MAP_COLORS.PIN_BLUE_START}, ${MAP_COLORS.PIN_BLUE_END});
                    width:32px; height:32px; border-radius:50% 50% 50% 0;
                    transform:rotate(-45deg); border:3px solid white;
                    box-shadow:0 3px 8px rgba(59,130,246,0.5);
                "></div>
            </div>`,
        iconSize:   [32, 40],
        iconAnchor: [16, 40],
        className:  '',
    });

    const dropoffIcon = L.divIcon({
        html: `
            <div style="display:flex; flex-direction:column; align-items:center;">
                <div style="
                    background: linear-gradient(135deg, ${MAP_COLORS.PIN_AMBER_START}, ${MAP_COLORS.PIN_AMBER_END});
                    width:32px; height:32px; border-radius:50% 50% 50% 0;
                    transform:rotate(-45deg); border:3px solid white;
                    box-shadow:0 3px 8px rgba(245,158,11,0.5);
                "></div>
            </div>`,
        iconSize:   [32, 40],
        iconAnchor: [16, 40],
        className:  '',
    });

    // ── Auto-pan component ──────────────────────────────────────────────────
    function PanController() {
        const map = useMap();
        const lastPos = useRef<[number, number] | null>(null);

        useEffect(() => {
            if (!shouldRecenter) return;
            if (lastPos.current &&
                lastPos.current[0] === position[0] &&
                lastPos.current[1] === position[1]) return;
            lastPos.current = position;
            map.panTo(position, { animate: true, duration: 0.6, easeLinearity: 0.3 });
        });
        return null;
    }

    // ── Route coords ────────────────────────────────────────────────────────
    // Priority: live OSRM route > initial booking route > breadcrumb trail
    const activeRoute = liveRoute || routeGeometry;
    const routeCoords: [number, number][] = activeRoute?.coordinates
        ? activeRoute.coordinates.map(([lng, lat]) => [lat, lng])
        : [];

    return (
        <MapContainer
            center={position}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            zoomControl={true}
        >
            {/* Map tiles */}
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                maxZoom={19}
            />

            <PanController />

            {/* OSRM route polyline */}
            {routeCoords.length > 1 && (
                <Polyline
                    positions={routeCoords}
                    color={MAP_COLORS.ROUTE_LINE} weight={5} opacity={0.8}
                    dashArray={liveRoute ? undefined : '10,6'}
                />
            )}

            {/* Breadcrumb trail (recent GPS history) */}
            {positions.length > 2 && (
                <Polyline
                    positions={positions.slice(-80)}
                    color={MAP_COLORS.BREADCRUMB_LINE} weight={2} opacity={0.35}
                />
            )}

            {/* Driver marker with heading rotation */}
            <Marker position={position} icon={truckIcon}>
                <Popup>
                    <div style={{ textAlign: 'center', minWidth: 120 }}>
                        <div style={{ fontSize: 24 }}>🚜</div>
                        <div style={{ fontWeight: 600 }}>Driver Location</div>
                        {speed > 0 && <div className="text-slate-500 text-xs">{speed.toFixed(1)} km/h</div>}
                    </div>
                </Popup>
            </Marker>

            {/* Pickup pin */}
            {pickupLat != null && pickupLng != null && (
                <Marker position={[pickupLat, pickupLng]} icon={pickupIcon}>
                    <Popup>📍 Pickup Location</Popup>
                </Marker>
            )}

            {/* Dropoff pin */}
            {dropoffLat != null && dropoffLng != null && (
                <Marker position={[dropoffLat, dropoffLng]} icon={dropoffIcon}>
                    <Popup>🏁 Dropoff Location</Popup>
                </Marker>
            )}
        </MapContainer>
    );
}

const DynamicMap = dynamic(() => Promise.resolve(MapInner), {
    ssr: false,
    loading: () => (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8, animation: 'bounce 1s infinite' }}>🗺️</div>
                <p style={{ color: '#6b7280', fontSize: 14 }}>Loading map…</p>
            </div>
        </div>
    ),
});

// ── Main exported component ───────────────────────────────────────────────────

export default function TrackingMap({
    deliveryId,
    bookingId,
    initialLat  = 17.385,
    initialLng  = 78.4867,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    routeGeometry,
}: Props) {
    const effectiveId = bookingId || deliveryId || null;

    const { location, isConnected, connectionState, routeUpdate } =
        useBookingSocket(effectiveId, pickupLat, pickupLng);

    const [position,      setPosition]     = useState<[number, number]>([initialLat, initialLng]);
    const [positions,     setPositions]    = useState<[number, number][]>([[initialLat, initialLng]]);
    const [heading,       setHeading]      = useState(0);
    const [speed,         setSpeed]        = useState(0);
    const [shouldRecenter, setRecenter]    = useState(true);
    const [liveRoute,     setLiveRoute]    = useState<RouteGeometry | null>(null);

    // Update position from live socket feed
    useEffect(() => {
        if (!location) return;
        const next: [number, number] = [location.latitude, location.longitude];
        setPosition(next);
        setHeading(location.heading || 0);
        setSpeed(location.speed || 0);
        setPositions(prev => {
            const last = prev[prev.length - 1];
            if (last && last[0] === next[0] && last[1] === next[1]) return prev;
            return [...prev.slice(-99), next];
        });
    }, [location]);

    // Apply live route update from server OSRM recalc
    useEffect(() => {
        if (!routeUpdate?.route_geometry) return;
        setLiveRoute(routeUpdate.route_geometry as RouteGeometry);
    }, [routeUpdate]);

    // Signal quality badge color
    const signalColor = connectionState === 'connected'
        ? location ? MAP_COLORS.SIGNAL_LIVE : MAP_COLORS.SIGNAL_WAITING
        : MAP_COLORS.SIGNAL_DISCONNECTED;
    const signalLabel = connectionState === 'connected'
        ? location ? 'Live' : 'Waiting for GPS…'
        : connectionState === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';

    return (
        <div className="h-full w-full flex flex-col rounded-xl overflow-hidden border border-gray-200">

            {/* Status bar */}
            <div className="flex items-center gap-2.5 px-3 py-1.5 bg-white border-b border-gray-200 text-xs">
                <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{
                        background: signalColor,
                        boxShadow: isConnected && location ? `0 0 0 3px ${signalColor}33` : 'none',
                        animation: isConnected && location ? 'pulse 2s infinite' : 'none',
                    }}
                />
                <span className="font-semibold" style={{ color: signalColor }}>{signalLabel}</span>

                {location && (
                    <span className="ml-auto text-slate-400 text-[11px]">
                        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                        {speed > 0 && ` · ${speed.toFixed(1)} km/h`}
                        {location.accuracy && ` · ±${location.accuracy.toFixed(0)}m`}
                    </span>
                )}

                {/* Recenter button */}
                <button
                    onClick={() => setRecenter(r => !r)}
                    title={shouldRecenter ? 'Auto-pan ON' : 'Auto-pan OFF'}
                    className={`ml-2 px-2 py-0.5 rounded text-[11px] font-medium border border-gray-200 cursor-pointer transition-colors ${
                        shouldRecenter 
                            ? 'bg-green-50 text-green-600 hover:bg-green-100' 
                            : 'bg-gray-100 text-slate-500 hover:bg-gray-200'
                    }`}
                >
                    {shouldRecenter ? '📍 Auto' : '📍 Fixed'}
                </button>
            </div>

            {/* Map */}
            <div className="flex-1 min-h-0">
                <DynamicMap
                    position={position}
                    positions={positions}
                    heading={heading}
                    speed={speed}
                    routeGeometry={routeGeometry || null}
                    liveRoute={liveRoute}
                    pickupLat={pickupLat}
                    pickupLng={pickupLng}
                    dropoffLat={dropoffLat}
                    dropoffLng={dropoffLng}
                    onRecenter={() => setRecenter(true)}
                    shouldRecenter={shouldRecenter}
                />
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-6px); }
                }
            `}</style>
        </div>
    );
}
