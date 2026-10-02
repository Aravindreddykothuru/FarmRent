/**
 * Driver workflow end to end: a free driver near the pickup point is attached to a new booking, delivers it
 * once the owner confirms, and closes the rental with the renter's completion code.
 *
 * Drivers are not a second kind of owner: they cannot confirm or decline a request, they cannot touch a
 * booking that is not theirs, and they cannot deliver an online booking that has not been paid for.
 */
const { createClient } = require('redis');
const { getApp, resetRateLimits, isoDate, createUser, login, createEquipment, withDb } = require('./helpers');

const DRIVERS_GEO_KEY = 'drivers:geo';

const plate = () => `AP${Math.floor(Math.random() * 90 + 10)}XX${Math.floor(Math.random() * 9000 + 1000)}`;

/** Registers the current user as a driver who is online, sharing location and parked at `where`. */
async function onlineDriver(name, where) {
    const user = await createUser('owner', name);
    const agent = await login(user);
    await agent
        .post('/api/v1/drivers/register')
        .send({ vehicle_name: 'Mahindra Pickup', vehicle_type: 'pickup', vehicle_number: plate() })
        .expect(201);
    await agent.patch('/api/v1/drivers/availability').send({ is_available: true }).expect(200);
    await agent.patch('/api/v1/drivers/share-location').send({ sharing: true }).expect(200);
    await agent
        .patch('/api/v1/drivers/location')
        .send({ latitude: where.lat, longitude: where.lng, heading: 0, speed: 0, accuracy: 8 })
        .expect(200);
    const profile = (await agent.get('/api/v1/drivers/me').expect(200)).body.data;
    return { user, agent, id: profile.id };
}

/** Assignment runs after the booking response is sent, so give it a moment. */
async function assignedDriverId(bookingId, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const { rows } = await withDb((db) => db.query('SELECT driver_id FROM equipment_rentals WHERE id = $1', [bookingId]));
        if (rows[0]?.driver_id) return rows[0].driver_id;
        if (Date.now() > deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

describe('driver trips', () => {
    // Anantapur, where the test equipment lives (helpers.createEquipment).
    const where = { lat: 14.69, lng: 77.61 };
    let driver;
    let owner;
    let renter;
    let renterAgent;
    let ownerAgent;
    let equipmentId;

    const book = (extra = {}) =>
        renterAgent
            .post('/api/v1/bookings')
            .send({ machineId: equipmentId, startDate: isoDate(200), endDate: isoDate(201), paymentMethod: 'cod', ...extra });

    beforeAll(async () => {
        await resetRateLimits();

        // Drivers left behind by earlier runs sit at the same coordinates and would be picked ahead of this
        // one, so park them: the geo index is emptied and every other driver is taken offline.
        await withDb((db) => db.query('UPDATE drivers SET is_available = FALSE'));
        const redis = createClient({ url: process.env.REDIS_URL });
        await redis.connect();
        await redis.del(DRIVERS_GEO_KEY);
        await redis.quit();

        driver = await onlineDriver('Driver Yadav', where);
        owner = await createUser('owner', 'Driver Test Owner');
        renter = await createUser('farmer', 'Driver Test Renter');
        [ownerAgent, renterAgent] = await Promise.all([login(owner), login(renter)]);
        equipmentId = await createEquipment(owner.id, { dailyRate: 900, deposit: 0 });
    });

    beforeEach(() => resetRateLimits());

    test('a booking is assigned to the nearest free driver, who delivers it and closes it with the renter code', async () => {
        const created = (await book().expect(201)).body.data;
        const path = `/api/v1/bookings/${created.id}`;
        expect(await assignedDriverId(created.id)).toBe(driver.id);

        // Confirming a request is the owner's decision alone.
        expect((await driver.agent.patch(`${path}/accept`).expect(403)).body.error.code).toBe('FORBIDDEN');
        expect((await driver.agent.patch(`${path}/reject`).expect(403)).body.error.code).toBe('FORBIDDEN');

        // Nothing to deliver until the owner confirms.
        expect((await driver.agent.post('/api/v1/drivers/trip/start').send({ booking_id: created.id }).expect(409)).body.error.code).toBe(
            'INVALID_TRANSITION',
        );

        await ownerAgent.patch(`${path}/accept`).expect(200);
        const started = await driver.agent.post('/api/v1/drivers/trip/start').send({ booking_id: created.id }).expect(200);
        expect(started.body.data.status).toBe('in_progress');

        // The trip ends only with the code the renter is shown.
        const { otp } = (await renterAgent.get(`${path}/completion-otp`).expect(200)).body.data;
        const wrongOtp = String((Number(otp) + 1) % 1000000).padStart(6, '0');
        expect(
            (await driver.agent.post('/api/v1/drivers/trip/end').send({ booking_id: created.id, otp: wrongOtp }).expect(400)).body.error
                .code,
        ).toBe('INVALID_OTP');
        expect((await driver.agent.post('/api/v1/drivers/trip/end').send({ booking_id: created.id }).expect(400)).body.error.code).toBe(
            'OTP_REQUIRED',
        );

        const ended = await driver.agent.post('/api/v1/drivers/trip/end').send({ booking_id: created.id, otp }).expect(200);
        expect(ended.body.data.status).toBe('completed');

        // Finishing a trip frees the driver and counts towards their record.
        const { rows } = await withDb((db) => db.query('SELECT is_available, total_trips FROM drivers WHERE id = $1', [driver.id]));
        expect(rows[0]).toMatchObject({ is_available: true, total_trips: 1 });
    });

    test('a driver cannot touch a booking that is not theirs', async () => {
        const stranger = await onlineDriver('Driver Stranger', where);
        // Off the road, so the next booking is not offered to them and this one is plainly not theirs.
        await stranger.agent.patch('/api/v1/drivers/availability').send({ is_available: false }).expect(200);

        const created = (await book({ startDate: isoDate(210), endDate: isoDate(211) }).expect(201)).body.data;
        await withDb((db) => db.query('UPDATE equipment_rentals SET driver_id = $1 WHERE id = $2', [driver.id, created.id]));
        await ownerAgent.patch(`/api/v1/bookings/${created.id}/accept`).expect(200);

        const refused = await stranger.agent.post('/api/v1/drivers/trip/start').send({ booking_id: created.id }).expect(404);
        expect(refused.body.error.code).toBe('BOOKING_NOT_FOUND');
    });

    test('an online booking is not delivered until it is paid', async () => {
        const created = (await book({ startDate: isoDate(220), endDate: isoDate(221), paymentMethod: 'razorpay' }).expect(201)).body.data;
        await withDb((db) => db.query('UPDATE equipment_rentals SET driver_id = $1 WHERE id = $2', [driver.id, created.id]));
        await ownerAgent.patch(`/api/v1/bookings/${created.id}/accept`).expect(200);

        expect((await driver.agent.post('/api/v1/drivers/trip/start').send({ booking_id: created.id }).expect(409)).body.error.code).toBe(
            'PAYMENT_REQUIRED',
        );

        await withDb((db) => db.query("UPDATE equipment_rentals SET payment_status = 'paid' WHERE id = $1", [created.id]));
        const started = await driver.agent.post('/api/v1/drivers/trip/start').send({ booking_id: created.id }).expect(200);
        expect(started.body.data.status).toBe('in_progress');
    });

    test('the driver dashboard lists only this driver trips', async () => {
        const mine = (await driver.agent.get('/api/v1/bookings/driver').expect(200)).body.data;
        expect(mine.bookings.length).toBeGreaterThan(0);
        const ids = new Set(mine.bookings.map((b) => b.id));
        const { rows } = await withDb((db) =>
            db.query('SELECT id FROM equipment_rentals WHERE driver_id IS DISTINCT FROM $1 LIMIT 50', [driver.id]),
        );
        expect(rows.every((r) => !ids.has(r.id))).toBe(true);

        // A signed-in user without a driver profile simply has no trips.
        const noTrips = (await renterAgent.get('/api/v1/bookings/driver').expect(200)).body.data;
        expect(noTrips).toMatchObject({ bookings: [], total: 0 });
        await require('supertest')(getApp()).get('/api/v1/bookings/driver').expect(401);
    });
});
