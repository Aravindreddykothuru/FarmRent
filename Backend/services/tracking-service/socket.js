/**
 * tracking-service/socket.js — Production-grade real-time GPS tracking
 *
 * Architecture follows Uber/Ola patterns:
 *   • Redis pub/sub adapter for horizontal scaling across multiple Node instances
 *   • Per-driver server-side Kalman filtering (smooths noisy GPS before broadcast)
 *   • GPS jump & fake-location detection (drops bad points server-side)
 *   • Duplicate connection dedup: same driverId → old socket disconnected
 *   • Rate limiting: 1 location update accepted per driver per second
 *   • Trip history batching: accumulate 10 points → flush to Supabase
 *   • Heartbeat/ping: detect dead connections without disconnection event
 *   • Last-known-position served from Redis to new joiners
 *   • Heading smoothing via circular interpolation
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { pubClient, subClient, redisClient } = require('./redisClient');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../../lib/jwtSecret');
const { GPSKalmanFilter } = require('../../lib/kalmanGPS');
const { validateGPS, detectMockLocation } = require('../../lib/gpsValidator');

let io;

// ── In-process state (per-instance; Redis is the source of truth for multi-instance) ──
/** driverId → socket.id (dedup: one active socket per driver) */
const driverSockets = new Map();
/** driverId → GPSKalmanFilter */
const kalmanFilters = new Map();
/** driverId → last accepted GPS point (for jump detection) */
const lastGPS = new Map();
/** driverId → last accepted timestamp (rate limiting) */
const lastUpdateTime = new Map();
/** driverId → sliding window of recent GPS points (mock detection) */
const gpsWindows = new Map();
/** driverId → pending batch of trip_locations rows to flush */
const tripBatches = new Map();

// ── Geofencing ────────────────────────────────────────────────────────────────

const GEOFENCE_COOLDOWN_MS = 5 * 60 * 1000; // 1 alert per 5 minutes per booking
/** bookingId → last breach alert timestamp */
const geofenceAlerts = new Map();

/** Haversine distance in km */
function haversineKm(lat1, lng1, lat2, lng2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function checkGeofence(bookingId, driverLat, driverLng, nsInstance) {
    if (!bookingId) return;

    const now      = Date.now();
    const lastAlert = geofenceAlerts.get(bookingId) || 0;
    if (now - lastAlert < GEOFENCE_COOLDOWN_MS) return;

    try {
        const supabase = require('../../lib/supabase');
        if (!supabase) return;

        const { data: booking } = await supabase
            .from('bookings')
            .select('renter_id, owner_id, pickup_lat, pickup_lng, geofence_radius_km')
            .eq('id', bookingId)
            .maybeSingle();

        if (!booking?.pickup_lat || !booking?.pickup_lng) return;

        const radius  = booking.geofence_radius_km || 50; // default 50 km
        const dist    = haversineKm(driverLat, driverLng, booking.pickup_lat, booking.pickup_lng);

        if (dist > radius) {
            geofenceAlerts.set(bookingId, now);

            const alert = {
                type:       'geofence_breach',
                bookingId,
                distanceKm: Math.round(dist * 10) / 10,
                radiusKm:   radius,
                lat:        driverLat,
                lng:        driverLng,
                message:    `Vehicle is ${(dist).toFixed(1)} km from pickup point (limit: ${radius} km)`,
            };

            // Alert the booking room
            nsInstance.to(`booking_${bookingId}`).emit('geofence:breach', alert);

            // Persist notification for both parties
            const { sendNotification } = require('../../lib/notificationService');
            const notif = { type: 'geofence_breach', title: 'Geofence Alert', message: alert.message, data: { bookingId } };
            if (booking.renter_id) sendNotification(booking.renter_id, notif).catch(() => {});
            if (booking.owner_id)  sendNotification(booking.owner_id,  notif).catch(() => {});
        }
    } catch (e) {
        console.warn('[geofence] Check failed:', e.message);
    }
}

const RATE_LIMIT_MS = 800;       // min ms between accepted updates per driver
const BATCH_SIZE    = 10;        // flush DB after accumulating this many points
const BATCH_TIMEOUT = 20_000;    // flush DB after this many ms regardless
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT  = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSocketUser(socket) {
    try {
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.query?.token;
        if (!token) return null;
        const payload = jwt.verify(token, getJwtSecret());
        return { id: payload.sub || payload.id, role: payload.role || 'farmer' };
    } catch {
        return null;
    }
}

/** Interpolate heading via circular mean (avoids 359→1° wrap-around jumps) */
function smoothHeading(prevDeg, nextDeg, alpha = 0.3) {
    if (prevDeg == null) return nextDeg;
    const diff = ((nextDeg - prevDeg + 540) % 360) - 180;
    return (prevDeg + alpha * diff + 360) % 360;
}

/** Push a GPS row to the in-process batch and flush if threshold reached */
async function batchTripLocation(bookingId, driverId, point) {
    if (!bookingId || !driverId) return;

    const key = `${bookingId}:${driverId}`;
    if (!tripBatches.has(key)) {
        tripBatches.set(key, { rows: [], timer: null });
    }
    const batch = tripBatches.get(key);
    batch.rows.push({
        booking_id: bookingId,
        driver_id: driverId,
        latitude: point.latitude,
        longitude: point.longitude,
        heading: point.heading || 0,
        speed: point.speed || 0,
        accuracy: point.accuracy || 10,
        gps_flags: point.flags || [],
    });

    if (batch.rows.length >= BATCH_SIZE) {
        await flushBatch(key);
    } else if (!batch.timer) {
        batch.timer = setTimeout(() => flushBatch(key), BATCH_TIMEOUT);
    }
}

async function flushBatch(key) {
    const batch = tripBatches.get(key);
    if (!batch || batch.rows.length === 0) return;

    clearTimeout(batch.timer);
    const rows = [...batch.rows];
    batch.rows = [];
    batch.timer = null;

    try {
        const supabase = require('../../lib/supabase');
        if (supabase && rows.length > 0) {
            await supabase.from('trip_locations').insert(rows);
        }
    } catch (e) {
        console.warn('[tracking] Batch flush failed:', e.message);
    }
}

// ── Socket.IO initialisation ──────────────────────────────────────────────────

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingInterval: HEARTBEAT_INTERVAL,
        pingTimeout: HEARTBEAT_TIMEOUT,
    });

    // Redis adapter — scales across multiple server instances
    io.adapter(createAdapter(pubClient, subClient));

    // ─────────────────────────────────────────────────────────────────────────
    // /tracking namespace — GPS, booking rooms, driver location stream
    // ─────────────────────────────────────────────────────────────────────────
    const trackingNS = io.of('/tracking');

    trackingNS.on('connection', async (socket) => {
        const user = parseSocketUser(socket);

        // ── A. Join booking room (farmer watching a delivery) ─────────────────
        socket.on('join_booking_room', async (bookingId) => {
            if (!bookingId) return;
            const room = `booking_${bookingId}`;
            socket.join(room);

            // Serve last known position immediately so the UI doesn't wait
            try {
                if (redisClient?.isReady) {
                    const cached = await redisClient.hGet(`booking_latest:${bookingId}`, 'location').catch(() => null);
                    if (cached) {
                        socket.emit('location_update', { ...JSON.parse(cached), fromCache: true });
                    }
                }
            } catch (e) { /* non-critical */ }
        });

        socket.on('leave_booking_room', (bookingId) => {
            socket.leave(`booking_${bookingId}`);
        });

        // Legacy room support
        socket.on('join_delivery_room', (deliveryId) => socket.join(`delivery_${deliveryId}`));
        socket.on('leave_delivery_room', (deliveryId) => socket.leave(`delivery_${deliveryId}`));

        // ── B. Driver registers themselves (online → ready to receive bookings) ─
        socket.on('driver:register', async ({ driverId }) => {
            if (!driverId) return;

            // Dedup: disconnect old socket for this driver
            const oldSocketId = driverSockets.get(driverId);
            if (oldSocketId && oldSocketId !== socket.id) {
                const oldSocket = trackingNS.sockets.get(oldSocketId);
                if (oldSocket) {
                    oldSocket.emit('force_disconnect', { reason: 'New connection from same driver' });
                    oldSocket.disconnect(true);
                }
            }

            driverSockets.set(driverId, socket.id);
            socket.data.driverId = driverId;
            socket.join(`driver_${driverId}`);

            // Initialize Kalman filter for this driver
            if (!kalmanFilters.has(driverId)) {
                kalmanFilters.set(driverId, new GPSKalmanFilter());
            }
            if (!gpsWindows.has(driverId)) {
                gpsWindows.set(driverId, []);
            }

            // Store online status in Redis
            if (redisClient?.isReady) {
                await redisClient.hSet(`driver_socket:${driverId}`, {
                    socketId: socket.id,
                    connectedAt: Date.now(),
                    isOnline: '1',
                }).catch(() => {});
                await redisClient.expire(`driver_socket:${driverId}`, 3600).catch(() => {});
            }

            socket.emit('driver:registered', { driverId, socketId: socket.id });
        });

        // ── C. Driver → GPS location update (primary hot path) ────────────────
        // Payload: { driverId, bookingId, latitude, longitude, heading, speed, accuracy }
        socket.on('driver:location_update', async (data) => {
            const {
                driverId,
                bookingId,
                latitude,
                longitude,
                heading = 0,
                speed = 0,
                accuracy = 10,
            } = data || {};

            if (!driverId) return;

            // ── Rate limiting (server-side, per driver) ─────────────────────
            const now = Date.now();
            const lastTs = lastUpdateTime.get(driverId) || 0;
            if (now - lastTs < RATE_LIMIT_MS) return;
            lastUpdateTime.set(driverId, now);

            // ── GPS validation ──────────────────────────────────────────────
            const prev = lastGPS.get(driverId);
            const { valid, reason, flags } = validateGPS(
                { lat: Number(latitude), lng: Number(longitude), accuracy, speed, timestamp: now },
                prev ? { lat: prev.latitude, lng: prev.longitude, timestamp: prev.timestamp } : null
            );

            if (!valid) {
                console.warn(`[GPS] Rejected update from driver ${driverId}: ${reason}`);
                socket.emit('gps:rejected', { reason, flags });
                return;
            }

            // ── Mock location detection (sliding window) ───────────────────
            const window = gpsWindows.get(driverId) || [];
            window.push({ lat: Number(latitude), lng: Number(longitude), accuracy, timestamp: now });
            if (window.length > 20) window.shift();
            gpsWindows.set(driverId, window);

            const mockCheck = detectMockLocation(window);
            if (mockCheck.isFake && mockCheck.confidence > 0.8) {
                console.warn(`[GPS] Fake location suspected for driver ${driverId}: ${mockCheck.reason}`);
                socket.emit('gps:warning', { type: 'MOCK_LOCATION', reason: mockCheck.reason, confidence: mockCheck.confidence });
                // Don't hard-reject here — warn but still process (could be false positive)
            }

            // ── Kalman filter smoothing ─────────────────────────────────────
            let kalman = kalmanFilters.get(driverId);
            if (!kalman) {
                kalman = new GPSKalmanFilter();
                kalmanFilters.set(driverId, kalman);
            }
            const smoothed = kalman.filter(Number(latitude), Number(longitude), accuracy);

            // ── Heading smoothing ────────────────────────────────────────────
            const smoothedHeading = smoothHeading(prev?.heading, Number(heading));

            // ── Assemble broadcast payload ──────────────────────────────────
            const locationPayload = {
                driverId,
                latitude:  smoothed.lat,
                longitude: smoothed.lng,
                rawLat:    Number(latitude),
                rawLng:    Number(longitude),
                heading:   smoothedHeading,
                speed:     Number(speed),
                accuracy:  Number(accuracy),
                flags,
                timestamp: now,
            };

            // Remember as last good position
            lastGPS.set(driverId, locationPayload);

            // ── Broadcast to booking room ───────────────────────────────────
            if (bookingId) {
                trackingNS.to(`booking_${bookingId}`).emit('location_update', locationPayload);
            }
            // Legacy delivery room
            trackingNS.to(`delivery_${driverId}`).emit('location_update', locationPayload);

            // ── Cache in Redis ──────────────────────────────────────────────
            if (redisClient?.isReady) {
                const serialized = JSON.stringify(locationPayload);
                const pipeline = redisClient.multi();
                // GEO index for nearest-driver queries
                pipeline.geoAdd('drivers:geo', {
                    longitude: smoothed.lng,
                    latitude:  smoothed.lat,
                    member:    String(driverId),
                });
                // Latest position cache (30 min TTL)
                pipeline.hSet(`driver_latest:${driverId}`, 'location', serialized);
                pipeline.expire(`driver_latest:${driverId}`, 1800);
                if (bookingId) {
                    pipeline.hSet(`booking_latest:${bookingId}`, 'location', serialized);
                    pipeline.expire(`booking_latest:${bookingId}`, 1800);
                }
                await pipeline.exec().catch(() => {});
            }

            // ── DB: update driver row + batch trip_locations ────────────────
            try {
                const supabase = require('../../lib/supabase');
                if (supabase) {
                    supabase.from('drivers').update({
                        current_lat: smoothed.lat,
                        current_lng: smoothed.lng,
                        heading:     smoothedHeading,
                        speed:       Number(speed),
                    }).eq('id', driverId).then(() => {}).catch(() => {});
                }
            } catch { /* non-critical */ }

            // ── Geofencing check ────────────────────────────────────────────
            checkGeofence(bookingId, smoothed.lat, smoothed.lng, trackingNS).catch(() => {});

            // Batch persist for trip history
            await batchTripLocation(bookingId, driverId, { ...locationPayload, flags });
        });

        // ── D. Driver status events ───────────────────────────────────────────
        socket.on('driver:go_online', async ({ driverId }) => {
            if (!driverId) return;
            try {
                const supabase = require('../../lib/supabase');
                if (supabase) {
                    await supabase.from('drivers').update({ is_available: true }).eq('id', driverId);
                }
                if (redisClient?.isReady) {
                    await redisClient.hSet(`driver_socket:${driverId}`, 'isOnline', '1').catch(() => {});
                }
                trackingNS.to(`driver_${driverId}`).emit('driver:status', { driverId, isOnline: true });
            } catch (e) { console.warn('[socket] go_online error:', e.message); }
        });

        socket.on('driver:go_offline', async ({ driverId }) => {
            if (!driverId) return;
            try {
                const supabase = require('../../lib/supabase');
                if (supabase) {
                    await supabase.from('drivers').update({ is_available: false }).eq('id', driverId);
                }
                if (redisClient?.isReady) {
                    await redisClient.zRem('drivers:geo', String(driverId)).catch(() => {});
                    await redisClient.hSet(`driver_socket:${driverId}`, 'isOnline', '0').catch(() => {});
                }
                // Flush any pending batch
                await flushBatch(`${socket.data.bookingId}:${driverId}`);
            } catch (e) { console.warn('[socket] go_offline error:', e.message); }
        });

        socket.on('driver:trip_started', async ({ driverId, bookingId }) => {
            if (!driverId || !bookingId) return;
            socket.data.bookingId = bookingId;
            // Reset Kalman so we start fresh for this trip
            kalmanFilters.get(driverId)?.reset();
            lastGPS.delete(driverId);
        });

        socket.on('driver:trip_ended', async ({ driverId, bookingId }) => {
            if (!driverId) return;
            // Flush remaining batch
            await flushBatch(`${bookingId}:${driverId}`);
            // Clean up Redis GEO (driver is no longer "online + moving")
            if (redisClient?.isReady) {
                await redisClient.zRem('drivers:geo', String(driverId)).catch(() => {});
            }
        });

        // ── E. Farmer requests route refresh ─────────────────────────────────
        socket.on('request:route_refresh', async ({ bookingId, driverLat, driverLng, pickupLat, pickupLng }) => {
            if (!bookingId || !driverLat || !pickupLat) return;
            try {
                const { getRouteWithFallback } = require('../routing-service/osrm');
                const route = await getRouteWithFallback(driverLat, driverLng, pickupLat, pickupLng);
                socket.emit('route_update', { bookingId, route });
            } catch (e) { /* non-critical */ }
        });

        // ── F. Disconnect cleanup ─────────────────────────────────────────────
        socket.on('disconnect', async (reason) => {
            const driverId = socket.data?.driverId;

            if (driverId) {
                // Only remove from map if this is still the active socket
                if (driverSockets.get(driverId) === socket.id) {
                    driverSockets.delete(driverId);
                    // Flush pending batch on disconnect
                    const bookingId = socket.data?.bookingId;
                    await flushBatch(`${bookingId}:${driverId}`);

                    // Brief grace period: if driver reconnects within 30s, don't mark offline
                    setTimeout(async () => {
                        if (!driverSockets.has(driverId)) {
                            // Still disconnected after grace period — mark unavailable
                            try {
                                if (redisClient?.isReady) {
                                    await redisClient.hSet(`driver_socket:${driverId}`, 'isOnline', '0').catch(() => {});
                                }
                            } catch { /* ignore */ }
                        }
                    }, 30_000);
                }
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // /notifications namespace — push alerts to individual users
    // ─────────────────────────────────────────────────────────────────────────
    const notifNS = io.of('/notifications');

    notifNS.on('connection', (socket) => {
        const user = parseSocketUser(socket);
        if (user?.id) {
            socket.join(`user_${user.id}`);
        }
        socket.on('disconnect', () => {});
    });

    return io;
};

const getIo = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};

/**
 * Emit a booking status change to booking room + individual user notification rooms.
 */
function emitBookingStatusChange(bookingId, payload, userIds = []) {
    try {
        const tNS   = getIo().of('/tracking');
        const nNS   = getIo().of('/notifications');
        tNS.to(`booking_${bookingId}`).emit('booking:status_changed', payload);
        userIds.forEach(uid => {
            nNS.to(`user_${uid}`).emit('notification', { type: 'booking_update', ...payload });
        });
    } catch (e) {
        console.warn('[socket] emitBookingStatusChange error:', e.message);
    }
}

/**
 * Emit ETA update to a booking room (called from REST route-refresh endpoint).
 */
function emitEtaUpdate(bookingId, etaPayload) {
    try {
        getIo().of('/tracking').to(`booking_${bookingId}`).emit('eta_update', etaPayload);
    } catch { /* ignore */ }
}

module.exports = { initializeSocket, getIo, emitBookingStatusChange, emitEtaUpdate };
