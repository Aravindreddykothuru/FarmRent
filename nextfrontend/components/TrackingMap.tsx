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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } = require('react-leaflet');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
                    background: linear-gradient(135deg, #16a34a, #15803d);
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
                    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
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
                    background: linear-gradient(135deg, #f59e0b, #d97706);
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
                    color="#16a34a" weight={5} opacity={0.8}
                    dashArray={liveRoute ? undefined : '10,6'}
                />
            )}

            {/* Breadcrumb trail (recent GPS history) */}
            {positions.length > 2 && (
                <Polyline
                    positions={positions.slice(-80)}
                    color="#6b7280" weight={2} opacity={0.35}
                />
            )}

            {/* Driver marker with heading rotation */}
            <Marker position={position} icon={truckIcon}>
                <Popup>
                    <div style={{ textAlign: 'center', minWidth: 120 }}>
                        <div style={{ fontSize: 24 }}>🚜</div>
                        <div style={{ fontWeight: 600 }}>Driver Location</div>
                        {speed > 0 && <div style={{ color: '#6b7280', fontSize: 12 }}>{speed.toFixed(1)} km/h</div>}
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
        ? location ? '#16a34a' : '#f59e0b'
        : '#ef4444';
    const signalLabel = connectionState === 'connected'
        ? location ? 'Live' : 'Waiting for GPS…'
        : connectionState === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';

    return (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }}>

            {/* Status bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                background: 'white', borderBottom: '1px solid #e5e7eb', fontSize: 13,
            }}>
                <span style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: signalColor,
                    boxShadow: isConnected && location ? `0 0 0 3px ${signalColor}33` : 'none',
                    animation: isConnected && location ? 'pulse 2s infinite' : 'none',
                }} />
                <span style={{ fontWeight: 500, color: signalColor }}>{signalLabel}</span>

                {location && (
                    <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 11 }}>
                        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                        {speed > 0 && ` · ${speed.toFixed(1)} km/h`}
                        {location.accuracy && ` · ±${location.accuracy.toFixed(0)}m`}
                    </span>
                )}

                {/* Recenter button */}
                <button
                    onClick={() => setRecenter(r => !r)}
                    title={shouldRecenter ? 'Auto-pan ON' : 'Auto-pan OFF'}
                    style={{
                        marginLeft: 8, padding: '2px 8px', borderRadius: 6, fontSize: 11,
                        border: '1px solid #e5e7eb', cursor: 'pointer',
                        background: shouldRecenter ? '#dcfce7' : '#f3f4f6',
                        color:      shouldRecenter ? '#16a34a' : '#6b7280',
                        fontWeight: 500,
                    }}
                >
                    {shouldRecenter ? '📍 Auto' : '📍 Fixed'}
                </button>
            </div>

            {/* Map */}
            <div style={{ flex: 1, minHeight: 0 }}>
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
