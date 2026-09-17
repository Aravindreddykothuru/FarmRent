/**
 * tracking-service/equipmentPosition.js — one path for every live equipment position
 *
 * Used by the owner's phone broadcaster (Socket.IO `equipment:location_update`), its REST fallback
 * (POST /api/v1/tracking/equipment-update) and hardware trackers (POST /api/v1/tracking/device-update).
 * All writes go through the API's service role, so row-level security on the tables never starves this path,
 * and only the booking's parties receive the update (they must be admitted to the booking room first).
 */
'use strict';

const supabase = require('../../lib/supabase');
const logger = require('../../lib/logger');
const { HttpError } = require('../../lib/httpError');
const { redisClient } = require('./redisClient');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stored statuses in which a rental's live location is shared: confirmed, in use, being returned.
const TRACKABLE_STATUSES = ['approved', 'active', 'return_pending'];
const LATEST_TTL_SEC = 1800;

function db() {
    if (!supabase) throw new HttpError(503, 'DB_UNAVAILABLE', 'Database not configured');
    return supabase;
}

const optionalNumber = (value) =>
    value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function validCoordinates(latitude, longitude) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Valid latitude (-90..90) and longitude (-180..180) are required');
    }
    return { lat, lng };
}

/** The booking a position belongs to: it must exist, be for this equipment and be in a trackable status. */
async function trackableBooking(bookingId, equipmentId) {
    if (!UUID_RE.test(String(bookingId))) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const { data, error } = await db().from('equipment_rentals').select('id, equipment_id, status').eq('id', bookingId).maybeSingle();
    if (error) throw error;
    if (!data || data.equipment_id !== equipmentId) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking not found for this equipment');
    if (!TRACKABLE_STATUSES.includes(data.status)) {
        throw new HttpError(422, 'BOOKING_NOT_TRACKABLE', 'Live location is shared only for confirmed or active rentals');
    }
    return data;
}

/**
 * Records a position.
 * - With a booking: appended to the rental's trail (gps_locations), cached as the booking's latest position and
 *   pushed to the booking room. The listing's own coordinates are not moved by a tractor out in a field.
 * - Without a booking: the owner is updating where the listing is kept.
 * Returns the payload sent to the booking room.
 */
async function recordEquipmentPosition({
    equipmentId,
    bookingId,
    latitude,
    longitude,
    heading,
    speed,
    accuracy,
    altitude,
    source = 'mobile_gps',
    recordedAt,
}) {
    if (!UUID_RE.test(String(equipmentId))) throw new HttpError(400, 'VALIDATION_ERROR', 'equipment_id must be a UUID');
    const { lat, lng } = validCoordinates(latitude, longitude);
    const booking = bookingId ? await trackableBooking(bookingId, equipmentId) : null;

    const parsedTime = recordedAt ? new Date(recordedAt) : null;
    const at = parsedTime && !Number.isNaN(parsedTime.getTime()) && parsedTime.getTime() <= Date.now() + 60_000 ? parsedTime : new Date();

    const point = {
        equipmentId,
        bookingId: booking ? booking.id : null,
        latitude: lat,
        longitude: lng,
        heading: optionalNumber(heading),
        speed: optionalNumber(speed),
        accuracy: optionalNumber(accuracy),
        altitude: optionalNumber(altitude),
        source,
        timestamp: at.getTime(),
    };

    if (!booking) {
        // location_point is derived from latitude/longitude by a database trigger.
        const { error } = await db().from('equipment').update({ latitude: lat, longitude: lng }).eq('id', equipmentId);
        if (error) throw error;
        return point;
    }

    const { error: trailError } = await db()
        .from('gps_locations')
        .insert({
            rental_id: booking.id,
            equipment_id: equipmentId,
            location: `SRID=4326;POINT(${lng} ${lat})`,
            heading: point.heading,
            speed_kmh: point.speed,
            accuracy: point.accuracy,
            altitude: point.altitude,
            recorded_at: at.toISOString(),
        });
    if (trailError) throw trailError;

    if (redisClient?.isReady) {
        await redisClient
            .multi()
            .hSet(`booking_latest:${booking.id}`, 'location', JSON.stringify(point))
            .expire(`booking_latest:${booking.id}`, LATEST_TTL_SEC)
            .exec()
            .catch((err) => logger.warn('[tracking] latest position cache write failed', { bookingId: booking.id, error: err.message }));
    }

    // Required lazily: socket.js requires this module.
    const { isSocketReady, getIo } = require('./socket');
    if (isSocketReady()) getIo().of('/tracking').to(`booking_${booking.id}`).emit('location_update', point);

    return point;
}

module.exports = { recordEquipmentPosition, TRACKABLE_STATUSES };
