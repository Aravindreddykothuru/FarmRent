'use client';
/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * EquipmentMap – wraps all react-leaflet components in ONE dynamic import
 * so TypeScript sees the real types (no per-component dynamic imports).
 */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { IndianRupee, Star, MapPin } from 'lucide-react';

interface Machine {
    _id?: string;
    id?: string;
    name: string;
    type: string;
    location?: { district?: string; coordinates?: { coordinates?: [number, number] } };
    pricing?: { baseRatePerDay?: number };
    ratings?: { average?: number };
    images?: string[];
}

export interface Props { machines: Machine[] }

// Fix default Leaflet marker icons once at module load — never on re-render
let _iconsPatched = false;
function patchLeafletIcons() {
    if (_iconsPatched) return;
    const L = require('leaflet');
    delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });
    _iconsPatched = true;
}

// ── Inner component (uses react-leaflet with real types after hydration) ──────
function MapInner({ machines }: Props) {
    // These imports are safe here because this entire component is dynamic({ ssr: false })
    const { MapContainer, TileLayer, Marker, Popup } = require('react-leaflet');
    patchLeafletIcons(); // runs only on first mount, never on re-renders

    const withCoords = machines.filter((m) => {
        const coords = m.location?.coordinates?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return false;
        const [lng, lat] = coords;
        return Number.isFinite(lng) && Number.isFinite(lat);
    });

    const center: [number, number] = withCoords.length > 0
        ? [
            withCoords[0].location!.coordinates!.coordinates![1],
            withCoords[0].location!.coordinates!.coordinates![0],
        ]
        : [17.385, 78.4867]; // Hyderabad fallback

    return (
        <MapContainer center={center} zoom={8} style={{ height: '100%', width: '100%' }}>
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
            />
            {withCoords.map((m) => {
                const [lng, lat] = m.location!.coordinates!.coordinates!;
                const key = m._id ?? m.id ?? `${lat},${lng}`;
                return (
                    <Marker key={key} position={[lat, lng]}>
                        <Popup>
                            <div className="min-w-[180px] p-1">
                                {m.images?.[0] && (
                                    <img src={m.images[0]} alt={m.name}
                                        className="w-full h-24 object-cover rounded-md mb-2"
                                        onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; }} />
                                )}
                                <div className="font-semibold text-gray-900 mb-0.5">{m.name}</div>
                                {m.location?.district && (
                                    <div className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                                        <MapPin className="h-3 w-3" />{m.location.district}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm font-bold text-green-700 flex items-center gap-0.5">
                                        <IndianRupee className="h-3 w-3" />
                                        {m.pricing?.baseRatePerDay?.toLocaleString('en-IN')}
                                        <span className="text-xs font-normal text-gray-500">/day</span>
                                    </div>
                                    {(m.ratings?.average ?? 0) > 0 && (
                                        <div className="flex items-center gap-0.5 text-xs">
                                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                            {m.ratings!.average}
                                        </div>
                                    )}
                                </div>
                                <Link href={`/equipment/${m._id ?? m.id}`}
                                    className="block text-center bg-green-700 text-white rounded-md py-1 text-xs font-medium hover:bg-green-800 transition-colors">
                                    View Details
                                </Link>
                            </div>
                        </Popup>
                    </Marker>
                );
            })}
        </MapContainer>
    );
}

// Wrap in dynamic so Leaflet (which needs `window`) never runs on the server
const EquipmentMapDynamic = dynamic(
    () => Promise.resolve(MapInner),
    {
        ssr: false,
        loading: () => (
            <div className="h-full flex items-center justify-center bg-gray-100 rounded-2xl">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-700" />
            </div>
        ),
    }
);

export default function EquipmentMap({ machines }: Props) {
    return (
        <div className="h-[520px] w-full rounded-2xl overflow-hidden shadow-md border">
            <EquipmentMapDynamic machines={machines} />
        </div>
    );
}
