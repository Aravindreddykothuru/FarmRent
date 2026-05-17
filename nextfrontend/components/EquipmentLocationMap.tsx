'use client';

/**
 * EquipmentLocationMap — Google Maps hybrid view for equipment detail pages.
 * Shows a marker at the equipment's lat/lng with the equipment name on click.
 * Falls back to a placeholder card when the API key is not configured.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, AlertCircle } from 'lucide-react';

interface Props {
    lat: number;
    lng: number;
    name: string;
    className?: string;
}

declare global {
    interface Window {
        google?: typeof google;
        _initGoogleMap?: () => void;
    }
}

let loadPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
    if (loadPromise) return loadPromise;
    if (typeof window !== 'undefined' && window.google?.maps) {
        loadPromise = Promise.resolve();
        return loadPromise;
    }
    loadPromise = new Promise((resolve, reject) => {
        const cb = '_initGoogleMap';
        window[cb] = resolve;
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=${cb}`;
        s.async = true;
        s.onerror = () => { loadPromise = null; reject(new Error('Google Maps failed to load')); };
        document.head.appendChild(s);
    });
    return loadPromise;
}

export default function EquipmentLocationMap({ lat, lng, name, className = 'h-64 rounded-2xl overflow-hidden' }: Props) {
    const mapRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const mapInstance = useRef<google.maps.Map | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

    const initMap = useCallback(() => {
        if (!mapRef.current || !window.google?.maps) return;
        const center = { lat, lng };
        const map = new window.google.maps.Map(mapRef.current, {
            center,
            zoom: 13,
            mapTypeId: 'hybrid',
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
            gestureHandling: 'cooperative',
        });
        mapInstance.current = map;

        const marker = new window.google.maps.Marker({
            position: center,
            map,
            title: name,
            animation: window.google.maps.Animation.DROP,
        });
        markerRef.current = marker;

        const infoWindow = new window.google.maps.InfoWindow({
            content: `<div style="font-size:13px;font-weight:700;padding:4px 2px">${name}</div>`,
        });
        marker.addListener('click', () => infoWindow.open(map, marker));
        setStatus('ready');
    }, [lat, lng, name]);

    useEffect(() => {
        if (!apiKey) { setStatus('error'); return; }
        loadGoogleMapsScript(apiKey)
            .then(initMap)
            .catch(() => setStatus('error'));
    }, [apiKey, initMap]);

    if (status === 'error' || !apiKey) {
        return (
            <div className={`${className} bg-gray-100 flex flex-col items-center justify-center gap-2`}>
                <AlertCircle className="h-8 w-8 text-gray-300" />
                <p className="text-sm text-gray-400 font-medium">Map not available</p>
                <p className="text-xs text-gray-400">
                    <MapPin className="h-3 w-3 inline mr-1" />
                    {lat.toFixed(4)}, {lng.toFixed(4)}
                </p>
            </div>
        );
    }

    return (
        <div className={`${className} relative`}>
            <div ref={mapRef} className="w-full h-full" />
            {status === 'loading' && (
                <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700" />
                        <p className="text-xs text-gray-500">Loading map…</p>
                    </div>
                </div>
            )}
        </div>
    );
}
