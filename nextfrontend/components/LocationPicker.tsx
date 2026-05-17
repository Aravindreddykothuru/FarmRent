'use client';
/* eslint-disable @typescript-eslint/no-require-imports */

import dynamic from 'next/dynamic';
import { Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useLanguage } from '@/context/LanguageContext';

interface LatLng { lat: number; lng: number }
export interface AddressParts {
    village:  string;
    district: string;
    state:    string;
    pincode:  string;
}
interface Result { lat: number; lng: number; address: string; parts: AddressParts }
interface Props { onLocationChange: (r: Result) => void; initialLatLng?: LatLng }
type SearchResult = { lat: number; lng: number; label: string };

// Module-level constant — never recreated on re-render
const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629]; // India centre

// ── API helpers ───────────────────────────────────────────────────────────────

function nominatimUrl(endpoint: 'search' | 'reverse', params: Record<string, string>) {
    const u = new URL(`https://nominatim.openstreetmap.org/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
}

async function reverseGeocode(lat: number, lng: number, signal: AbortSignal): Promise<{ displayName: string; parts: AddressParts }> {
    const res  = await fetch(nominatimUrl('reverse', { lat: String(lat), lon: String(lng), format: 'json', addressdetails: '1' }),
        { headers: { 'Accept-Language': 'en' }, signal });
    const data = await res.json().catch(() => null);
    const a = data?.address ?? {};
    return {
        displayName: data?.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        parts: {
            village:  a.village || a.hamlet || a.suburb || a.neighbourhood || a.locality || '',
            district: a.town    || a.city   || a.county || a.district      || a.state_district || '',
            state:    a.state   || '',
            pincode:  a.postcode || '',
        },
    };
}

async function searchPlaces(q: string, signal: AbortSignal): Promise<SearchResult[]> {
    const res  = await fetch(nominatimUrl('search', { q, format: 'json', addressdetails: '1', limit: '6' }),
        { headers: { 'Accept-Language': 'en' }, signal });
    const data = await res.json().catch(() => []);
    return Array.isArray(data)
        ? data.map((r: any) => ({ lat: +r.lat, lng: +r.lon, label: String(r.display_name ?? '') }))
              .filter(r => isFinite(r.lat) && isFinite(r.lng) && r.label)
        : [];
}

async function searchByPincode(pin: string, signal: AbortSignal): Promise<SearchResult[]> {
    const res  = await fetch(nominatimUrl('search', { postalcode: pin, country: 'India', format: 'json', addressdetails: '1', limit: '8' }),
        { headers: { 'Accept-Language': 'en' }, signal });
    const data = await res.json().catch(() => []);
    const rows = Array.isArray(data)
        ? data.map((r: any) => ({ lat: +r.lat, lng: +r.lon, label: String(r.display_name ?? '') }))
              .filter((r: SearchResult) => isFinite(r.lat) && isFinite(r.lng) && r.label)
        : [];
    return rows.length ? rows : searchPlaces(`${pin} India`, signal);
}

// ── Leaflet icon patch — once per app lifetime ────────────────────────────────
let _iconsPatched = false;
function patchIcons() {
    if (_iconsPatched) return;
    const L = require('leaflet');
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });
    _iconsPatched = true;
}

// ── Stable map sub-components at module level ─────────────────────────────────
// These must NOT be defined inside PickerInner — React would see a new function
// reference on every parent render and unmount/remount them, re-firing useEffect.

const SizeWatcher = memo(function SizeWatcher() {
    const { useMap } = require('react-leaflet');
    const map = useMap();
    useEffect(() => {
        // Run after paint so Leaflet reads the correct container dimensions
        const t = setTimeout(() => { map.invalidateSize({ animate: false }); }, 50);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
});

const FlyToHandler = memo(function FlyToHandler({ target }: { target: LatLng | null }) {
    const { useMap } = require('react-leaflet');
    const map     = useMap();
    const lastKey = useRef<string | null>(null);

    useEffect(() => {
        if (!target) return;
        const key = `${target.lat},${target.lng}`;
        if (lastKey.current === key) return; // deduplicate — never fly to same spot twice
        lastKey.current = key;
        map.flyTo([target.lat, target.lng], 14, { duration: 1.0, easeLinearity: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    return null;
});

const MapClickHandler = memo(function MapClickHandler({
    onMapClick,
}: { onMapClick: (lat: number, lng: number) => void }) {
    const { useMapEvents } = require('react-leaflet');
    // Ref pattern: handler always reads latest closure, no stale captures
    const cbRef = useRef(onMapClick);
    cbRef.current = onMapClick;
    useMapEvents({
        click(e: { latlng: { lat: number; lng: number } }) {
            cbRef.current(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
});

// ── Inner component ───────────────────────────────────────────────────────────
function PickerInner({ onLocationChange, initialLatLng }: Props) {
    const { MapContainer, TileLayer, Marker } = require('react-leaflet');
    patchIcons();
    const { t } = useLanguage();

    // Map state — isolated from form state, never causes map remount
    const initialCenter = useRef<[number, number]>(
        initialLatLng ? [initialLatLng.lat, initialLatLng.lng] : DEFAULT_CENTER
    );
    const initialZoom   = useRef<number>(initialLatLng ? 14 : 6);

    const [markerPos,      setMarkerPos]      = useState<LatLng | null>(initialLatLng ?? null);
    const [flyToTarget,    setFlyToTarget]    = useState<LatLng | null>(null);

    // Form-side state — changes here never affect the map's mount/identity
    const [address,        setAddress]        = useState('');
    const [geocoding,      setGeocoding]      = useState(false);
    const [geoError,       setGeoError]       = useState('');
    const [pincode,        setPincode]        = useState('');
    const [pincodeLoading, setPincodeLoading] = useState(false);
    const [query,          setQuery]          = useState('');
    const [searching,      setSearching]      = useState(false);
    const [suggestions,    setSuggestions]    = useState<SearchResult[]>([]);
    const [dropdownOpen,   setDropdownOpen]   = useState(false);

    const latestReqId         = useRef(0);
    const reverseCtrlRef      = useRef<AbortController | null>(null);
    const searchCtrlRef       = useRef<AbortController | null>(null);
    const pincodeCtrlRef      = useRef<AbortController | null>(null);

    // ── Reverse geocode ───────────────────────────────────────────────────────
    const applyLocation = useCallback(async (lat: number, lng: number) => {
        setMarkerPos({ lat, lng });
        setGeocoding(true);
        setGeoError('');

        const reqId = ++latestReqId.current;
        reverseCtrlRef.current?.abort();
        const ctrl = new AbortController();
        reverseCtrlRef.current = ctrl;

        try {
            const { displayName, parts } = await reverseGeocode(lat, lng, ctrl.signal);
            if (latestReqId.current !== reqId) return;
            setAddress(displayName);
            onLocationChange({ lat, lng, address: displayName, parts });
        } catch {
            if (ctrl.signal.aborted) return;
            const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            setAddress(fallback);
            onLocationChange({ lat, lng, address: fallback, parts: { village: '', district: '', state: '', pincode: '' } });
        } finally {
            if (latestReqId.current === reqId) setGeocoding(false);
        }
    }, [onLocationChange]);

    // ── PIN code search ───────────────────────────────────────────────────────
    const handlePincodeSearch = useCallback(async () => {
        const pin = pincode.trim();
        if (!/^\d{6}$/.test(pin)) { setGeoError(t('location.invalidPin')); return; }
        setGeoError('');
        setPincodeLoading(true);
        setSuggestions([]);
        setDropdownOpen(false);

        pincodeCtrlRef.current?.abort();
        const ctrl = new AbortController();
        pincodeCtrlRef.current = ctrl;

        try {
            const results = await searchByPincode(pin, ctrl.signal);
            if (ctrl.signal.aborted) return;
            if (!results.length) { setGeoError(t('location.pinNotFound')); return; }

            setFlyToTarget({ lat: results[0].lat, lng: results[0].lng });
            void applyLocation(results[0].lat, results[0].lng);

            if (results.length > 1) { setSuggestions(results.slice(1)); setDropdownOpen(true); }
        } catch {
            if (!ctrl.signal.aborted) setGeoError(t('location.connectionError'));
        } finally {
            if (!ctrl.signal.aborted) setPincodeLoading(false);
        }
    }, [pincode, applyLocation, t]);

    // ── Browser GPS ───────────────────────────────────────────────────────────
    const handleGPS = useCallback(() => {
        setGeoError('');
        if (!('geolocation' in navigator)) { setGeoError('Geolocation not supported.'); return; }
        navigator.geolocation.getCurrentPosition(
            ({ coords: { latitude: lat, longitude: lng } }) => {
                setFlyToTarget({ lat, lng });
                void applyLocation(lat, lng);
            },
            (err) => setGeoError(
                err.code === err.PERMISSION_DENIED
                    ? t('location.locationDenied')
                    : t('location.gpsError')
            ),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, [applyLocation, t]);

    // ── Debounced text search ─────────────────────────────────────────────────
    useEffect(() => {
        const q = query.trim();
        setGeoError('');
        if (q.length < 3) {
            searchCtrlRef.current?.abort();
            setSuggestions([]);
            setDropdownOpen(false);
            return;
        }
        setSearching(true);
        searchCtrlRef.current?.abort();
        const ctrl = new AbortController();
        searchCtrlRef.current = ctrl;
        const t = setTimeout(() => {
            searchPlaces(q, ctrl.signal)
                .then(rows => {
                    if (ctrl.signal.aborted) return;
                    setSuggestions(rows);
                    setDropdownOpen(rows.length > 0);
                })
                .catch(() => { if (!ctrl.signal.aborted) setSuggestions([]); })
                .finally(() => { if (!ctrl.signal.aborted) setSearching(false); });
        }, 350);
        return () => { clearTimeout(t); ctrl.abort(); };
    }, [query]);

    // ── Cleanup on unmount ────────────────────────────────────────────────────
    useEffect(() => () => {
        reverseCtrlRef.current?.abort();
        searchCtrlRef.current?.abort();
        pincodeCtrlRef.current?.abort();
    }, []);

    // ── Map click handler ─────────────────────────────────────────────────────
    const handleMapClick = useCallback((lat: number, lng: number) => {
        setSuggestions([]);
        setDropdownOpen(false);
        void applyLocation(lat, lng);
    }, [applyLocation]);

    return (
        <div className="flex flex-col gap-2">

            {/* ── PIN code row ─────────────────────────────────────────────── */}
            <div className="flex gap-2">
                <Input
                    value={pincode}
                    onChange={e => { setPincode(e.target.value.replace(/\D/g, '').slice(0, 6)); setGeoError(''); }}
                    onKeyDown={e => e.key === 'Enter' && void handlePincodeSearch()}
                    placeholder={t('location.pinCodePlaceholder')}
                    maxLength={6}
                    inputMode="numeric"
                    className="h-9 rounded-xl text-sm"
                />
                <Button
                    type="button"
                    onClick={() => void handlePincodeSearch()}
                    disabled={pincodeLoading || pincode.length !== 6}
                    className="h-9 px-3 bg-green-700 hover:bg-green-800 rounded-xl shrink-0"
                >
                    {pincodeLoading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <><Search className="h-3.5 w-3.5 mr-1" />Go</>}
                </Button>
            </div>

            {/* ── Text search row ───────────────────────────────────────────── */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onFocus={() => suggestions.length > 0 && setDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setDropdownOpen(false), 160)}
                        placeholder={t('location.searchPlaceholder')}
                        className="h-9 rounded-xl text-sm"
                    />
                    {/* Absolutely-positioned dropdown — NEVER pushes layout down */}
                    {(dropdownOpen || searching) && (
                        <div className="absolute top-full left-0 right-0 z-[1000] mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                            {searching && (
                                <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
                                    <Loader2 className="h-3 w-3 animate-spin" /> {t('common.search')}…
                                </div>
                            )}
                            {!searching && suggestions.length > 0 && (
                                <div className="max-h-44 overflow-y-auto divide-y divide-gray-50">
                                    {suggestions.map((s, i) => (
                                        <button
                                            key={`${s.lat},${s.lng},${i}`}
                                            type="button"
                                            onMouseDown={e => {
                                                e.preventDefault(); // prevent blur from closing before click
                                                setQuery(s.label);
                                                setSuggestions([]);
                                                setDropdownOpen(false);
                                                setFlyToTarget({ lat: s.lat, lng: s.lng });
                                                void applyLocation(s.lat, s.lng);
                                            }}
                                            className="w-full text-left px-3 py-2 text-xs hover:bg-green-50 flex items-start gap-2 transition-colors"
                                        >
                                            <MapPin className="h-3 w-3 mt-0.5 text-green-600 shrink-0" />
                                            <span className="line-clamp-2 leading-relaxed">{s.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={handleGPS}
                    title={t('location.gpsButton')}
                    className="h-9 px-3 rounded-xl shrink-0"
                >
                    <Crosshair className="h-3.5 w-3.5" />
                </Button>
            </div>

            {/* ── Error strip — RESERVED height so nothing below it shifts ──── */}
            <div className="min-h-[28px] flex items-center">
                {geoError && (
                    <p className="w-full text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-snug">
                        {geoError}
                    </p>
                )}
            </div>

            {/* ── Map — permanently fixed, never resizes or shifts ─────────── */}
            {/* shrink-0 prevents flex parents from squishing it                */}
            <div className="h-64 w-full shrink-0 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <MapContainer
                    center={initialCenter.current}
                    zoom={initialZoom.current}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                    attributionControl={false}
                >
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="© OpenStreetMap contributors"
                    />
                    <SizeWatcher />
                    <MapClickHandler onMapClick={handleMapClick} />
                    <FlyToHandler target={flyToTarget} />
                    {markerPos && <Marker position={[markerPos.lat, markerPos.lng]} />}
                </MapContainer>
            </div>

            {/* ── Address strip — RESERVED height so nothing below shifts ───── */}
            <div className="min-h-[40px] flex items-start pt-0.5">
                {geocoding ? (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 py-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{t('location.gettingAddress')}</span>
                    </div>
                ) : address ? (
                    <div className="flex items-start gap-1.5 w-full text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 leading-relaxed">
                        <MapPin className="h-3.5 w-3.5 mt-0.5 text-green-600 shrink-0" />
                        <span>{address}</span>
                    </div>
                ) : (
                    <p className="text-xs text-gray-400 py-1">
                        {t('location.enterPinCode')}
                    </p>
                )}
            </div>

        </div>
    );
}

// ── Dynamic wrapper — loading skeleton mirrors the exact final layout ─────────
const LocationPickerDynamic = dynamic(() => Promise.resolve(PickerInner), {
    ssr: false,
    loading: () => (
        <div className="flex flex-col gap-2">
            <div className="h-9 rounded-xl bg-gray-100 animate-pulse" />
            <div className="h-9 rounded-xl bg-gray-100 animate-pulse" />
            <div className="min-h-[28px]" />
            <div className="h-64 w-full shrink-0 rounded-xl bg-gray-100 animate-pulse" />
            <div className="min-h-[40px]" />
        </div>
    ),
});

export default function LocationPicker(props: Props) {
    return <LocationPickerDynamic {...props} />;
}
