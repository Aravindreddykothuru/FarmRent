/**
 * gpsValidator.js — Production GPS validation & anomaly detection pipeline
 *
 * Detects:
 *   - Invalid / out-of-range coordinates
 *   - Null Island (0,0) — common in mocks
 *   - GPS jumps (physically impossible speed between consecutive points)
 *   - Fake/mock location signatures (identical accuracy, perfect straight lines)
 *   - Stale / future timestamps
 *   - Excessive speed anomalies
 */

const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance in km */
function haversineKm(lat1, lng1, lat2, lng2) {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Validate a single GPS point, optionally against previous point.
 *
 * @param {{ lat, lng, accuracy, speed, heading, timestamp }} point
 * @param {{ lat, lng, timestamp } | null} prev
 * @returns {{ valid: boolean, reason?: string, flags: string[] }}
 */
function validateGPS(point, prev = null) {
    const flags = [];
    const {
        lat,
        lng,
        accuracy = 10,
        speed = 0,
        timestamp = Date.now(),
    } = point;

    // ── 1. Basic type/bounds ──────────────────────────────────────────────────
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { valid: false, reason: 'Non-finite coordinates', flags: ['INVALID_COORDS'] };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { valid: false, reason: 'Coordinates out of WGS-84 bounds', flags: ['OUT_OF_BOUNDS'] };
    }

    // ── 2. Null Island (0°,0°) — ocean off Ghana, almost always a mock ────────
    if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
        return { valid: false, reason: 'Null Island (0,0) coordinates', flags: ['NULL_ISLAND'] };
    }

    // ── 3. Timestamp sanity ───────────────────────────────────────────────────
    const age = Date.now() - timestamp;
    if (age > 60_000) flags.push('STALE_GPS');   // > 1 min old
    if (age < -5_000) flags.push('FUTURE_TS');   // >5s in future (clock skew)

    // ── 4. Accuracy heuristics (mock apps often report perfect 0 or 1m) ───────
    if (accuracy <= 0)   flags.push('ZERO_ACCURACY');
    if (accuracy < 1)    flags.push('SUSPICIOUSLY_ACCURATE');   // < 1m is impossible outdoors
    if (accuracy > 2000) flags.push('VERY_LOW_ACCURACY');

    // ── 5. Reported speed validation ──────────────────────────────────────────
    // Farm equipment max ~80 km/h, transport vehicles ~200 km/h
    if (speed > 250) flags.push('EXCESSIVE_SPEED');

    // ── 6. GPS jump detection (inter-point physics) ───────────────────────────
    if (prev && Number.isFinite(prev.lat) && Number.isFinite(prev.lng) && prev.timestamp) {
        const distKm   = haversineKm(prev.lat, prev.lng, lat, lng);
        const dtSec    = Math.max(0.1, (timestamp - prev.timestamp) / 1000);
        const impliedKmh = (distKm / dtSec) * 3600;

        // Hard reject: faster than any land vehicle
        if (impliedKmh > 350) {
            return {
                valid: false,
                reason: `GPS jump: ${impliedKmh.toFixed(0)} km/h implied speed (${distKm.toFixed(3)} km in ${dtSec.toFixed(1)}s)`,
                flags: [...flags, 'GPS_JUMP'],
            };
        }
        if (impliedKmh > 150) flags.push('HIGH_SPEED_WARN');
    }

    return { valid: true, flags };
}

/**
 * Detect fake/mock location patterns over a sliding window of recent points.
 *
 * @param {Array<{ lat, lng, accuracy, timestamp }>} recent — last N points (min 5)
 * @returns {{ isFake: boolean, confidence: number, reason: string | null }}
 */
function detectMockLocation(recent) {
    if (recent.length < 5) return { isFake: false, confidence: 0, reason: null };

    // Pattern 1: All accuracy values exactly identical
    const accs = recent.map(p => p.accuracy);
    const uniqueAcc = new Set(accs.map(a => a?.toFixed(4)));
    if (uniqueAcc.size === 1 && accs[0] < 100) {
        return {
            isFake: true,
            confidence: 0.85,
            reason: `Identical accuracy (${accs[0]}m) across ${recent.length} consecutive points`,
        };
    }

    // Pattern 2: All timestamps exactly equidistant (scripted replay)
    if (recent.length >= 5) {
        const gaps = [];
        for (let i = 1; i < recent.length; i++) {
            gaps.push(recent[i].timestamp - recent[i - 1].timestamp);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const allSame = gaps.every(g => Math.abs(g - avgGap) < 10); // ±10ms
        if (allSame && avgGap < 2000) {
            return {
                isFake: true,
                confidence: 0.7,
                reason: `Perfectly equidistant timestamps (${avgGap.toFixed(0)}ms interval)`,
            };
        }
    }

    // Pattern 3: Movement in a mathematically perfect straight line
    if (recent.length >= 5) {
        const pts = recent.slice(-5);
        let isCollinear = true;
        const refDLat = pts[1].lat - pts[0].lat;
        const refDLng = pts[1].lng - pts[0].lng;
        for (let i = 2; i < pts.length; i++) {
            const cross =
                (pts[i].lng - pts[0].lng) * refDLat -
                (pts[i].lat - pts[0].lat) * refDLng;
            if (Math.abs(cross) > 1e-7) { isCollinear = false; break; }
        }
        const totalDist = haversineKm(pts[0].lat, pts[0].lng, pts[4].lat, pts[4].lng);
        if (isCollinear && totalDist > 0.05) {
            return {
                isFake: true,
                confidence: 0.65,
                reason: 'Perfect straight-line movement (geometric pattern)',
            };
        }
    }

    return { isFake: false, confidence: 0, reason: null };
}

module.exports = { validateGPS, detectMockLocation, haversineKm };
