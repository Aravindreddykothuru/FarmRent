/**
 * tracking-service/socket.js — real-time GPS tracking and notifications (Socket.IO)
 *
 * Namespaces:
 *   /tracking       booking rooms (live location, status changes, messages) — booking participants only
 *   /notifications  one room per user — authenticated sockets only
 *
 * Sockets authenticate with the same access token as the REST API: the httpOnly `token` cookie sent by
 * the same-origin web client, or `auth.token` in the handshake for other clients. Driver identity always
 * comes from the authenticated user's driver profile, never from event payloads.
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const { pubClient, subClient, redisClient, getHasGeoSupport } = require('./redisClient');
const { getJwtSecret } = require('../../lib/jwtSecret');
const { sortRoles } = require('../../lib/roles');
const { GPSKalmanFilter } = require('../../lib/kalmanGPS');
const { validateGPS, detectMockLocation } = require('../../lib/gpsValidator');
const logger = require('../../lib/logger');

let io;

const driverSockets = new Map();
const kalmanFilters = new Map();
const lastGPS = new Map();
const lastUpdateTime = new Map();
const gpsWindows = new Map();
const tripBatches = new Map();
const geofenceAlerts = new Map();
const bookingEquipmentMap = new Map();

const GEOFENCE_COOLDOWN_MS = 5 * 60 * 1000;
const RATE_LIMIT_MS = 800;
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 20_000;
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKABLE_STATUSES = ['approved', 'active', 'return_pending'];

// Lazy: lib/supabase pulls in config that is not needed until the first event.
const db = () => require('../../lib/supabase');
const warnOnFailure =
    (context, meta = {}) =>
    (err) =>
        logger.warn(`[socket] ${context}`, { ...meta, error: err?.message });

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Authentication & authorization ───────────────────────────────────────────

function readCookie(header, name) {
    if (!header) return null;
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
}

async function resolveSocketUser(socket) {
    // Browsers authenticate with the httpOnly session cookie; other clients may pass a token in the handshake.
    // Each candidate is verified in turn so a stale or placeholder handshake token cannot mask a valid session.
    const candidates = [socket.handshake.auth?.token, readCookie(socket.handshake.headers?.cookie, 'token')].filter(
        (token) => typeof token === 'string' && token.length > 0,
    );
    for (const token of candidates) {
        const user = await verifySocketToken(token);
        if (user) return user;
    }
    return null;
}

async function verifySocketToken(token) {
    try {
        const payload = jwt.verify(token, getJwtSecret());
        const { isBlocklisted } = require('../../lib/tokenBlocklist');
        if (await isBlocklisted(token)) return null;
        if (payload.sid) {
            const sessionService = require('../auth-service/sessionService');
            if (!(await sessionService.verifySession(payload.sid))) return null;
        }
        const roles = sortRoles(Array.isArray(payload.roles) ? payload.roles : [payload.role]);
        const id = payload.sub || payload.id;
        return id && roles.length ? { id, roles } : null;
    } catch {
        return null;
    }
}

const isAdmin = (user) => Boolean(user?.roles?.includes('admin'));

async function canAccessBooking(user, bookingId) {
    if (!user || !UUID_RE.test(String(bookingId))) return false;
    if (isAdmin(user)) return true;
    const supabase = db();
    if (!supabase) return false;
    const { data, error } = await supabase
        .from('equipment_rentals')
        .select('renter_id, owner_id, drivers(user_id)')
        .eq('id', bookingId)
        .maybeSingle();
    if (error) {
        logger.warn('[socket] booking access check failed', { bookingId, error: error.message });
        return false;
    }
    return Boolean(data && (data.renter_id === user.id || data.owner_id === user.id || data.drivers?.user_id === user.id));
}

/** A driver's live position is visible to that driver, admins, and parties of a booking the driver is serving. */
async function canAccessDriver(user, driverId) {
    if (!user || !UUID_RE.test(String(driverId))) return false;
    if (isAdmin(user)) return true;
    const supabase = db();
    if (!supabase) return false;
    const { data: driver, error } = await supabase.from('drivers').select('user_id').eq('id', driverId).maybeSingle();
    if (error || !driver) return false;
    if (driver.user_id === user.id) return true;
    const { count, error: bookingError } = await supabase
        .from('equipment_rentals')
        .select('id', { count: 'exact', head: true })
        .eq('driver_id', driverId)
        .in('status', TRACKABLE_STATUSES)
        .or(`renter_id.eq.${user.id},owner_id.eq.${user.id}`);
    return !bookingError && count > 0;
}

async function isBookingAssignedToDriver(bookingId, driverId) {
    if (!UUID_RE.test(String(bookingId))) return false;
    const { data, error } = await db()
        .from('equipment_rentals')
        .select('id')
        .eq('id', bookingId)
        .eq('driver_id', driverId)
        .in('status', TRACKABLE_STATUSES)
        .maybeSingle();
    return !error && Boolean(data);
}

async function ownsEquipment(userId, equipmentId) {
    if (!UUID_RE.test(String(equipmentId))) return false;
    const { data, error } = await db().from('equipment').select('owner_id').eq('id', equipmentId).maybeSingle();
    return !error && data?.owner_id === userId;
}

/** Memoises a per-socket permission check so repeated location events do not hit the database. */
async function allowedOnce(socket, cacheKey, check) {
    socket.data.permissions = socket.data.permissions || new Map();
    if (!socket.data.permissions.has(cacheKey)) {
        socket.data.permissions.set(cacheKey, await check());
    }
    return socket.data.permissions.get(cacheKey);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getEquipmentIdForBooking(bookingId) {
    if (!bookingId) return null;
    if (bookingEquipmentMap.has(bookingId)) return bookingEquipmentMap.get(bookingId);
    const supabase = db();
    if (!supabase) return null;
    const { data, error } = await supabase.from('equipment_rentals').select('equipment_id').eq('id', bookingId).maybeSingle();
    if (error) {
        logger.warn('[socket] could not resolve equipment for booking', { bookingId, error: error.message });
        return null;
    }
    if (data?.equipment_id) bookingEquipmentMap.set(bookingId, data.equipment_id);
    return data?.equipment_id || null;
}

async function checkGeofence(bookingId, driverLat, driverLng, nsInstance) {
    if (!bookingId) return;

    const now = Date.now();
    const lastAlert = geofenceAlerts.get(bookingId) || 0;
    if (now - lastAlert < GEOFENCE_COOLDOWN_MS) return;

    const supabase = db();
    if (!supabase) return;

    const { data: booking, error } = await supabase
        .from('equipment_rentals')
        .select('renter_id, owner_id, pickup_lat, pickup_lng, geofence_radius_km')
        .eq('id', bookingId)
        .maybeSingle();
    if (error) throw error;
    if (booking?.pickup_lat == null || booking?.pickup_lng == null) return;

    const radius = Number(booking.geofence_radius_km) || 50;
    const dist = haversineKm(driverLat, driverLng, booking.pickup_lat, booking.pickup_lng);
    if (dist <= radius) return;

    geofenceAlerts.set(bookingId, now);
    const alert = {
        type: 'geofence_breach',
        bookingId,
        distanceKm: Math.round(dist * 10) / 10,
        radiusKm: radius,
        lat: driverLat,
        lng: driverLng,
        message: `Vehicle is ${dist.toFixed(1)} km from pickup point (limit: ${radius} km)`,
    };
    nsInstance.to(`booking_${bookingId}`).emit('geofence:breach', alert);

    const { sendNotification } = require('../../lib/notificationService');
    const notif = { type: 'geofence_breach', title: 'Geofence Alert', message: alert.message, data: { bookingId } };
    for (const userId of [booking.renter_id, booking.owner_id].filter(Boolean)) {
        sendNotification(userId, notif).catch(warnOnFailure('geofence notification failed', { bookingId }));
    }
}

function smoothHeading(prevDeg, nextDeg, alpha = 0.3) {
    if (prevDeg == null) return nextDeg;
    const diff = ((nextDeg - prevDeg + 540) % 360) - 180;
    return (prevDeg + alpha * diff + 360) % 360;
}

async function batchTripLocation(bookingId, sourceId, point) {
    if (!bookingId) return;

    const key = `${bookingId}:${sourceId}`;
    if (!tripBatches.has(key)) {
        tripBatches.set(key, { rows: [], timer: null });
    }
    const batch = tripBatches.get(key);

    const equipmentId = point.flags?.includes('equipment_gps') ? sourceId : await getEquipmentIdForBooking(bookingId);

    batch.rows.push({
        rental_id: bookingId,
        equipment_id: equipmentId || null,
        location: `POINT(${point.longitude} ${point.latitude})`,
        heading: point.heading || 0,
        speed_kmh: point.speed || 0,
        accuracy: point.accuracy || 10,
        altitude: point.altitude || 0,
        recorded_at: new Date(point.timestamp || Date.now()).toISOString(),
    });

    if (batch.rows.length >= BATCH_SIZE) {
        await flushBatch(key);
    } else if (!batch.timer) {
        batch.timer = setTimeout(() => {
            flushBatch(key).catch(warnOnFailure('scheduled GPS flush failed', { key }));
        }, BATCH_TIMEOUT);
    }
}

async function flushBatch(key) {
    const batch = tripBatches.get(key);
    if (!batch || batch.rows.length === 0) return;

    clearTimeout(batch.timer);
    const rows = [...batch.rows];
    batch.rows = [];
    batch.timer = null;

    const supabase = db();
    if (!supabase) return;
    // Breadcrumb trail served by GET /api/v1/tracking/booking/:id/history.
    const { error } = await supabase.from('gps_locations').insert(rows);
    if (error) logger.warn('[socket] GPS breadcrumb batch insert failed', { key, rows: rows.length, error: error.message });
}

async function persistDriverPosition(driverId, fields) {
    const { error } = await db().from('drivers').update(fields).eq('id', driverId);
    if (error) logger.warn('[socket] driver position update failed', { driverId, error: error.message });
}

// ── Server ───────────────────────────────────────────────────────────────────

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            // Same-origin in the unified server; CLIENT_URL covers a separately hosted web client.
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingInterval: HEARTBEAT_INTERVAL,
        pingTimeout: HEARTBEAT_TIMEOUT,
    });

    io.adapter(createAdapter(pubClient, subClient));

    const trackingNS = io.of('/tracking');

    trackingNS.use((socket, next) => {
        resolveSocketUser(socket)
            .then((user) => {
                socket.data.user = user;
                next();
            })
            .catch((err) => {
                logger.warn('[socket] authentication error', { error: err.message });
                next();
            });
    });

    trackingNS.on('connection', (socket) => {
        const requireDriver = () => socket.data.driverId || null;

        socket.on('join_booking_room', async (bookingId) => {
            if (!bookingId) return;
            const allowed = await allowedOnce(socket, `booking:${bookingId}`, () => canAccessBooking(socket.data.user, bookingId));
            if (!allowed) {
                socket.emit('room:denied', { room: 'booking', id: bookingId });
                return;
            }
            socket.join(`booking_${bookingId}`);

            if (redisClient?.isReady) {
                try {
                    const cached = await redisClient.hGet(`booking_latest:${bookingId}`, 'location');
                    if (cached) socket.emit('location_update', { ...JSON.parse(cached), fromCache: true });
                } catch (err) {
                    logger.warn('[socket] cached location read failed', { bookingId, error: err.message });
                }
            }
        });

        socket.on('leave_booking_room', (bookingId) => {
            socket.leave(`booking_${bookingId}`);
        });

        socket.on('join_delivery_room', async (driverId) => {
            if (!driverId) return;
            const allowed = await allowedOnce(socket, `driver:${driverId}`, () => canAccessDriver(socket.data.user, driverId));
            if (!allowed) {
                socket.emit('room:denied', { room: 'delivery', id: driverId });
                return;
            }
            socket.join(`delivery_${driverId}`);
        });
        socket.on('leave_delivery_room', (driverId) => socket.leave(`delivery_${driverId}`));

        socket.on('driver:register', async () => {
            const user = socket.data.user;
            if (!user) {
                socket.emit('driver:register_failed', { reason: 'unauthenticated' });
                return;
            }
            const { data: driver, error } = await db().from('drivers').select('id').eq('user_id', user.id).maybeSingle();
            if (error || !driver) {
                if (error) logger.warn('[socket] driver lookup failed', { userId: user.id, error: error.message });
                socket.emit('driver:register_failed', { reason: 'no_driver_profile' });
                return;
            }
            const driverId = driver.id;

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

            if (!kalmanFilters.has(driverId)) kalmanFilters.set(driverId, new GPSKalmanFilter());
            if (!gpsWindows.has(driverId)) gpsWindows.set(driverId, []);

            if (redisClient?.isReady) {
                await redisClient
                    .hSet(`driver_socket:${driverId}`, { socketId: socket.id, connectedAt: Date.now(), isOnline: '1' })
                    .catch(warnOnFailure('driver presence write failed', { driverId }));
                await redisClient
                    .expire(`driver_socket:${driverId}`, 3600)
                    .catch(warnOnFailure('driver presence expiry failed', { driverId }));
            }

            socket.emit('driver:registered', { driverId, socketId: socket.id });
        });

        socket.on('driver:location_update', async (data) => {
            const driverId = requireDriver();
            if (!driverId) return;
            const { latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = data || {};
            let { bookingId } = data || {};

            const now = Date.now();
            const lastTs = lastUpdateTime.get(driverId) || 0;
            if (now - lastTs < RATE_LIMIT_MS) return;
            lastUpdateTime.set(driverId, now);

            if (bookingId && !(await allowedOnce(socket, `drives:${bookingId}`, () => isBookingAssignedToDriver(bookingId, driverId)))) {
                bookingId = null;
            }

            const prev = lastGPS.get(driverId);
            const { valid, reason, flags } = validateGPS(
                { lat: Number(latitude), lng: Number(longitude), accuracy, speed, timestamp: now },
                prev ? { lat: prev.latitude, lng: prev.longitude, timestamp: prev.timestamp } : null,
            );

            if (!valid) {
                logger.warn('[GPS] rejected driver update', { driverId, reason });
                socket.emit('gps:rejected', { reason, flags });
                return;
            }

            const window = gpsWindows.get(driverId) || [];
            window.push({ lat: Number(latitude), lng: Number(longitude), accuracy, timestamp: now });
            if (window.length > 20) window.shift();
            gpsWindows.set(driverId, window);

            const mockCheck = detectMockLocation(window);
            if (mockCheck.isFake && mockCheck.confidence > 0.8) {
                logger.warn('[GPS] fake location suspected', { driverId, reason: mockCheck.reason });
                socket.emit('gps:warning', { type: 'MOCK_LOCATION', reason: mockCheck.reason, confidence: mockCheck.confidence });
            }

            let kalman = kalmanFilters.get(driverId);
            if (!kalman) {
                kalman = new GPSKalmanFilter();
                kalmanFilters.set(driverId, kalman);
            }
            const smoothed = kalman.filter(Number(latitude), Number(longitude), accuracy);
            const smoothedHeading = smoothHeading(prev?.heading, Number(heading));

            const locationPayload = {
                driverId,
                latitude: smoothed.lat,
                longitude: smoothed.lng,
                rawLat: Number(latitude),
                rawLng: Number(longitude),
                heading: smoothedHeading,
                speed: Number(speed),
                accuracy: Number(accuracy),
                flags,
                timestamp: now,
            };

            lastGPS.set(driverId, locationPayload);

            if (bookingId) {
                trackingNS.to(`booking_${bookingId}`).emit('location_update', locationPayload);
            }
            trackingNS.to(`delivery_${driverId}`).emit('location_update', locationPayload);

            if (redisClient?.isReady) {
                const serialized = JSON.stringify(locationPayload);
                const pipeline = redisClient.multi();
                if (getHasGeoSupport()) {
                    pipeline.geoAdd('drivers:geo', { longitude: smoothed.lng, latitude: smoothed.lat, member: String(driverId) });
                }
                pipeline.hSet(`driver_latest:${driverId}`, 'location', serialized);
                pipeline.expire(`driver_latest:${driverId}`, 1800);
                if (bookingId) {
                    pipeline.hSet(`booking_latest:${bookingId}`, 'location', serialized);
                    pipeline.expire(`booking_latest:${bookingId}`, 1800);
                    pipeline.set(`gps:last:${bookingId}`, serialized);
                    pipeline.expire(`gps:last:${bookingId}`, 86400);
                }
                await pipeline.exec().catch(warnOnFailure('driver location cache write failed', { driverId }));
            }

            persistDriverPosition(driverId, {
                current_lat: smoothed.lat,
                current_lng: smoothed.lng,
                heading: smoothedHeading,
                speed: Number(speed),
            }).catch(warnOnFailure('driver position update failed', { driverId }));

            checkGeofence(bookingId, smoothed.lat, smoothed.lng, trackingNS).catch(warnOnFailure('geofence check failed', { bookingId }));

            await batchTripLocation(bookingId, driverId, { ...locationPayload, flags });
        });

        socket.on('equipment:location_update', async (data) => {
            const user = socket.data.user;
            const { equipmentId, latitude, longitude, heading = 0, speed = 0, accuracy = 10 } = data || {};
            let { bookingId } = data || {};
            if (!user || !equipmentId) return;
            if (!(await allowedOnce(socket, `owns:${equipmentId}`, () => ownsEquipment(user.id, equipmentId)))) return;
            if (bookingId && (await getEquipmentIdForBooking(bookingId)) !== equipmentId) bookingId = null;

            const lat = Number(latitude);
            const lng = Number(longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            const now = Date.now();
            const locationPayload = {
                driverId: equipmentId,
                equipmentId,
                bookingId,
                latitude: lat,
                longitude: lng,
                heading: Number(heading),
                speed: Number(speed),
                accuracy: Number(accuracy),
                timestamp: now,
            };

            if (bookingId) {
                trackingNS.to(`booking_${bookingId}`).emit('location_update', locationPayload);
            }

            if (redisClient?.isReady) {
                const serialized = JSON.stringify(locationPayload);
                const pipeline = redisClient.multi();
                pipeline.hSet(`driver_latest:${equipmentId}`, 'location', serialized);
                pipeline.expire(`driver_latest:${equipmentId}`, 1800);
                if (bookingId) {
                    pipeline.hSet(`booking_latest:${bookingId}`, 'location', serialized);
                    pipeline.expire(`booking_latest:${bookingId}`, 1800);
                    pipeline.set(`gps:last:${bookingId}`, serialized);
                    pipeline.expire(`gps:last:${bookingId}`, 86400);
                }
                await pipeline.exec().catch(warnOnFailure('equipment location cache write failed', { equipmentId }));
            }

            // location_point is derived from latitude/longitude by a database trigger.
            const { error } = await db().from('equipment').update({ latitude: lat, longitude: lng }).eq('id', equipmentId);
            if (error) logger.warn('[socket] equipment position update failed', { equipmentId, error: error.message });

            if (bookingId) {
                await batchTripLocation(bookingId, equipmentId, { ...locationPayload, flags: ['equipment_gps'] });
            }
        });

        socket.on('driver:go_online', async () => {
            const driverId = requireDriver();
            if (!driverId) return;
            const { error } = await db().from('drivers').update({ is_available: true }).eq('id', driverId);
            if (error) logger.warn('[socket] go_online update failed', { driverId, error: error.message });
            if (redisClient?.isReady) {
                await redisClient
                    .hSet(`driver_socket:${driverId}`, 'isOnline', '1')
                    .catch(warnOnFailure('go_online presence failed', { driverId }));
            }
            trackingNS.to(`driver_${driverId}`).emit('driver:status', { driverId, isOnline: true });
        });

        socket.on('driver:go_offline', async () => {
            const driverId = requireDriver();
            if (!driverId) return;
            const { error } = await db().from('drivers').update({ is_available: false }).eq('id', driverId);
            if (error) logger.warn('[socket] go_offline update failed', { driverId, error: error.message });
            if (redisClient?.isReady) {
                await redisClient.zRem('drivers:geo', String(driverId)).catch(warnOnFailure('geo index removal failed', { driverId }));
                await redisClient
                    .hSet(`driver_socket:${driverId}`, 'isOnline', '0')
                    .catch(warnOnFailure('go_offline presence failed', { driverId }));
            }
            await flushBatch(`${socket.data.bookingId}:${driverId}`);
        });

        socket.on('driver:trip_started', async ({ bookingId } = {}) => {
            const driverId = requireDriver();
            if (!driverId || !bookingId) return;
            if (!(await allowedOnce(socket, `drives:${bookingId}`, () => isBookingAssignedToDriver(bookingId, driverId)))) return;
            socket.data.bookingId = bookingId;
            kalmanFilters.get(driverId)?.reset();
            lastGPS.delete(driverId);
        });

        socket.on('driver:trip_ended', async ({ bookingId } = {}) => {
            const driverId = requireDriver();
            if (!driverId) return;
            await flushBatch(`${bookingId}:${driverId}`);
            if (redisClient?.isReady) {
                await redisClient.zRem('drivers:geo', String(driverId)).catch(warnOnFailure('geo index removal failed', { driverId }));
            }
        });

        socket.on('request:route_refresh', async ({ bookingId, driverLat, driverLng, pickupLat, pickupLng } = {}) => {
            if (!bookingId || driverLat == null || pickupLat == null) return;
            if (!(await allowedOnce(socket, `booking:${bookingId}`, () => canAccessBooking(socket.data.user, bookingId)))) return;
            try {
                const { getRouteWithFallback } = require('../routing-service/osrm');
                const route = await getRouteWithFallback(driverLat, driverLng, pickupLat, pickupLng);
                socket.emit('route_update', { bookingId, route });
            } catch (err) {
                logger.warn('[socket] route refresh failed', { bookingId, error: err.message });
            }
        });

        socket.on('disconnect', async () => {
            const driverId = socket.data?.driverId;
            if (!driverId || driverSockets.get(driverId) !== socket.id) return;

            driverSockets.delete(driverId);
            await flushBatch(`${socket.data?.bookingId}:${driverId}`);

            setTimeout(() => {
                if (!driverSockets.has(driverId) && redisClient?.isReady) {
                    redisClient
                        .hSet(`driver_socket:${driverId}`, 'isOnline', '0')
                        .catch(warnOnFailure('offline presence write failed', { driverId }));
                }
            }, 30_000);
        });
    });

    const notifNS = io.of('/notifications');

    notifNS.use((socket, next) => {
        resolveSocketUser(socket)
            .then((user) => {
                if (!user) return next(new Error('unauthorized'));
                socket.data.user = user;
                return next();
            })
            .catch((err) => next(err));
    });

    notifNS.on('connection', (socket) => {
        socket.join(`user_${socket.data.user.id}`);
    });

    return io;
};

const getIo = () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
};

// False in processes that never start the HTTP server (tests, one-off scripts, queue workers).
const isSocketReady = () => Boolean(io);

function emitBookingStatusChange(bookingId, payload, userIds = []) {
    if (!io) return;
    io.of('/tracking').to(`booking_${bookingId}`).emit('booking:status_changed', payload);
    const notifications = io.of('/notifications');
    userIds.forEach((uid) => {
        notifications.to(`user_${uid}`).emit('notification', { type: 'booking_update', ...payload });
    });
}

function emitEtaUpdate(bookingId, etaPayload) {
    if (!io) return;
    io.of('/tracking').to(`booking_${bookingId}`).emit('eta_update', etaPayload);
}

module.exports = { initializeSocket, getIo, isSocketReady, emitBookingStatusChange, emitEtaUpdate, canAccessBooking, canAccessDriver };
