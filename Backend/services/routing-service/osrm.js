/**
 * routing-service/osrm.js
 * Real road distance & ETA using OSRM (Open Source Routing Machine)
 * Free public API — no key needed. Uses driving profile.
 */

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

/**
 * Get route between two coordinates using OSRM.
 * @returns { distance_km, duration_minutes, geometry } or null on failure
 */
async function getRoute(fromLat, fromLng, toLat, toLng) {
    try {
        const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) return null;
        const data = await res.json();

        if (data.code !== 'Ok' || !data.routes?.length) return null;

        const route = data.routes[0];
        return {
            distance_km: parseFloat((route.distance / 1000).toFixed(2)),
            duration_minutes: Math.ceil(route.duration / 60),
            geometry: route.geometry, // GeoJSON LineString
        };
    } catch (err) {
        console.warn('[OSRM] Route fetch failed:', err.message);
        return null;
    }
}

/**
 * Haversine straight-line fallback (km) when OSRM is unavailable.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

/**
 * Get route with haversine fallback.
 */
async function getRouteWithFallback(fromLat, fromLng, toLat, toLng) {
    const route = await getRoute(fromLat, fromLng, toLat, toLng);
    if (route) return route;

    // Fallback: straight-line * 1.3 road factor estimate
    const dist = haversineDistance(fromLat, fromLng, toLat, toLng);
    return {
        distance_km: parseFloat((dist * 1.3).toFixed(2)),
        duration_minutes: Math.ceil((dist * 1.3) / 40 * 60), // ~40km/h avg
        geometry: null,
    };
}

module.exports = { getRoute, getRouteWithFallback, haversineDistance };
