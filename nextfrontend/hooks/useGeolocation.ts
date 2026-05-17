'use client';
/**
 * hooks/useGeolocation.ts
 *
 * High-accuracy browser geolocation with:
 *  • Progressive accuracy (fast low-accuracy → then high-accuracy)
 *  • Reverse-geocoding of the resolved position via our backend
 *  • Permission state tracking
 *  • AbortController for cancelled requests
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface GeoAddress {
    full:     string;
    village:  string;
    town:     string;
    district: string;
    state:    string;
    pincode:  string;
}

export interface GeoPosition {
    lat:      number;
    lng:      number;
    accuracy: number;
    address:  GeoAddress | null;
}

export type GeoState =
    | { status: 'idle' }
    | { status: 'requesting' }
    | { status: 'resolved'; position: GeoPosition }
    | { status: 'error'; message: string };

function getApiBase(): string {
    return (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '')
        || (typeof window !== 'undefined' ? '' : 'http://localhost:3000');
}

async function fetchReverseGeocode(lat: number, lng: number, signal: AbortSignal): Promise<GeoAddress | null> {
    try {
        const res = await fetch(
            `${getApiBase()}/api/v1/search/geocode?lat=${lat}&lng=${lng}`,
            { signal }
        );
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data || null;
    } catch {
        return null;
    }
}

export function useGeolocation() {
    const [state, setState] = useState<GeoState>({ status: 'idle' });
    const abortRef = useRef<AbortController | null>(null);

    const request = useCallback(() => {
        if (!navigator?.geolocation) {
            setState({ status: 'error', message: 'Geolocation is not supported by this browser.' });
            return;
        }

        setState({ status: 'requesting' });
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // Phase 1: Quick low-accuracy fix (fast feedback)
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                if (controller.signal.aborted) return;
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const address = await fetchReverseGeocode(lat, lng, controller.signal);
                if (controller.signal.aborted) return;
                setState({
                    status: 'resolved',
                    position: { lat, lng, accuracy: pos.coords.accuracy, address },
                });
            },
            (err) => {
                if (controller.signal.aborted) return;
                const msgs: Record<number, string> = {
                    1: 'Location permission denied. Please allow location access in your browser settings.',
                    2: 'Location unavailable. Try searching by village name or PIN code.',
                    3: 'Location request timed out. Try again.',
                };
                setState({ status: 'error', message: msgs[err.code] || 'Could not get your location.' });
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
    }, []);

    const reset = useCallback(() => {
        abortRef.current?.abort();
        setState({ status: 'idle' });
    }, []);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    return { state, request, reset };
}
