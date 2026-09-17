/**
 * Socket.IO authentication and live delivery against the real app, Redis adapter and database.
 * Browsers authenticate sockets with the httpOnly session cookie; a handshake token is optional.
 */
const http = require('http');
const request = require('supertest');
const { io: connectClient } = require('socket.io-client');
const { getApp, resetRateLimits, createUser, createEquipment, isoDate } = require('./helpers');
const { initializeSocket, getIo } = require('../../services/tracking-service/socket');
const { pubClient, subClient } = require('../../services/tracking-service/redisClient');

let baseUrl;
const openSockets = [];

async function sessionCookie(user) {
    const res = await request(getApp()).post('/api/v1/auth/login').send({ email: user.email, password: user.password }).expect(200);
    return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}

function connect(namespace, { cookie, token } = {}) {
    return new Promise((resolve) => {
        const socket = connectClient(`${baseUrl}${namespace}`, {
            transports: ['websocket'],
            extraHeaders: cookie ? { cookie } : {},
            auth: token ? { token } : {},
            reconnection: false,
            forceNew: true,
            timeout: 5000,
        });
        openSockets.push(socket);
        socket.on('connect', () => resolve({ socket, error: null }));
        socket.on('connect_error', (err) => resolve({ socket, error: err.message }));
    });
}

/** Resolves with the next payload of `event`, or null if none arrives within `ms`. */
function nextEvent(socket, event, ms = 3000) {
    return new Promise((resolve) => {
        const handler = (payload) => {
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        };
        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve(null);
        }, ms);
        socket.on(event, handler);
    });
}

beforeAll(async () => {
    await resetRateLimits();
    const app = getApp();
    // getApp() starts the Redis connections; the Socket.IO Redis adapter needs its pub/sub clients ready first.
    const deadline = Date.now() + 15000;
    while (!(pubClient.isReady && subClient.isReady)) {
        if (Date.now() > deadline) throw new Error('Redis pub/sub clients did not become ready');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const server = http.createServer(app);
    initializeSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    openSockets.forEach((socket) => socket.close());
    await new Promise((resolve) => getIo().close(() => resolve()));
});

describe('socket authentication', () => {
    test('a connection without a session is refused', async () => {
        const { error } = await connect('/notifications');
        expect(error).toBe('unauthorized');
    });

    test('a forged handshake token is refused', async () => {
        const { error } = await connect('/notifications', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged' });
        expect(error).toBe('unauthorized');
    });

    test('the session cookie authenticates even when the client also sends a non-JWT placeholder token', async () => {
        const cookie = await sessionCookie(await createUser('owner'));
        const { error } = await connect('/notifications', { cookie, token: 'session-cookie' });
        expect(error).toBeNull();
    });
});

describe('booking rooms', () => {
    test('only the parties of a booking can join its live room', async () => {
        const owner = await createUser('owner');
        const renter = await createUser('farmer');
        const stranger = await createUser('farmer');
        const equipmentId = await createEquipment(owner.id, { dailyRate: 800, deposit: 0 });
        const [renterCookie, strangerCookie] = await Promise.all([sessionCookie(renter), sessionCookie(stranger)]);
        const booking = await request(getApp())
            .post('/api/v1/bookings')
            .set('Cookie', renterCookie)
            .send({ machineId: equipmentId, startDate: isoDate(20), endDate: isoDate(21), paymentMethod: 'cod' })
            .expect(201);
        const bookingId = booking.body.data.id;

        const strangerSocket = (await connect('/tracking', { cookie: strangerCookie })).socket;
        const renterSocket = (await connect('/tracking', { cookie: renterCookie })).socket;

        const strangerDenied = nextEvent(strangerSocket, 'room:denied');
        strangerSocket.emit('join_booking_room', bookingId);
        expect(await strangerDenied).toMatchObject({ room: 'booking', id: bookingId });

        const renterDenied = nextEvent(renterSocket, 'room:denied', 1000);
        renterSocket.emit('join_booking_room', bookingId);
        expect(await renterDenied).toBeNull();
    });
});

describe('live equipment tracking', () => {
    /** An owner, a renter, a stranger and a confirmed booking between the first two. */
    async function confirmedRental() {
        const owner = await createUser('owner');
        const renter = await createUser('farmer');
        const stranger = await createUser('owner');
        const equipmentId = await createEquipment(owner.id, { dailyRate: 700, deposit: 0 });
        const [ownerCookie, renterCookie, strangerCookie] = await Promise.all([
            sessionCookie(owner),
            sessionCookie(renter),
            sessionCookie(stranger),
        ]);
        const offset = 60 + Math.floor(Math.random() * 300);
        const booking = await request(getApp())
            .post('/api/v1/bookings')
            .set('Cookie', renterCookie)
            .send({ machineId: equipmentId, startDate: isoDate(offset), endDate: isoDate(offset + 1), paymentMethod: 'cod' })
            .expect(201);
        const bookingId = booking.body.data.id;
        await request(getApp()).patch(`/api/v1/bookings/${bookingId}/accept`).set('Cookie', ownerCookie).expect(200);
        return { owner, renter, equipmentId, bookingId, ownerCookie, renterCookie, strangerCookie };
    }

    async function renterWatching(rental) {
        const { socket } = await connect('/tracking', { cookie: rental.renterCookie });
        const denied = nextEvent(socket, 'room:denied', 1000);
        socket.emit('join_booking_room', rental.bookingId);
        expect(await denied).toBeNull();
        return socket;
    }

    const emitWithAck = (socket, payload) =>
        new Promise((resolve) => socket.timeout(5000).emit('equipment:location_update', payload, (err, ack) => resolve(err ? null : ack)));

    test("the owner's broadcast reaches the renter live and is kept in the rental's history; others are refused", async () => {
        const rental = await confirmedRental();
        const renterSocket = await renterWatching(rental);
        const ownerSocket = (await connect('/tracking', { cookie: rental.ownerCookie })).socket;
        const strangerSocket = (await connect('/tracking', { cookie: rental.strangerCookie })).socket;

        const refused = await emitWithAck(strangerSocket, {
            equipmentId: rental.equipmentId,
            bookingId: rental.bookingId,
            latitude: 14.7,
            longitude: 77.61,
        });
        expect(refused).toMatchObject({ ok: false, code: 'FORBIDDEN' });

        const received = nextEvent(renterSocket, 'location_update');
        const ack = await emitWithAck(ownerSocket, {
            equipmentId: rental.equipmentId,
            bookingId: rental.bookingId,
            latitude: 14.6951,
            longitude: 77.6123,
            speed: 12.5,
            heading: 90,
            accuracy: 8,
        });
        expect(ack).toMatchObject({ ok: true });
        expect(await received).toMatchObject({
            bookingId: rental.bookingId,
            equipmentId: rental.equipmentId,
            latitude: 14.6951,
            longitude: 77.6123,
            source: 'mobile_gps',
        });

        const history = await request(getApp())
            .get(`/api/v1/tracking/booking/${rental.bookingId}/history`)
            .set('Cookie', rental.renterCookie)
            .expect(200);
        expect(history.body.data).toEqual([expect.objectContaining({ latitude: 14.6951, longitude: 77.6123, speed: 12.5, heading: 90 })]);
        await request(getApp())
            .get(`/api/v1/tracking/booking/${rental.bookingId}/history`)
            .set('Cookie', rental.strangerCookie)
            .expect(404);
    });

    test('with the socket unavailable, the REST fallback reaches the renter the same way', async () => {
        const rental = await confirmedRental();
        const renterSocket = await renterWatching(rental);
        const received = nextEvent(renterSocket, 'location_update');
        await request(getApp())
            .post('/api/v1/tracking/equipment-update')
            .set('Cookie', rental.ownerCookie)
            .send({ equipment_id: rental.equipmentId, booking_id: rental.bookingId, lat: 14.7011, lng: 77.6201 })
            .expect(200);
        expect(await received).toMatchObject({ bookingId: rental.bookingId, latitude: 14.7011, longitude: 77.6201 });

        await request(getApp())
            .post('/api/v1/tracking/equipment-update')
            .set('Cookie', rental.strangerCookie)
            .send({ equipment_id: rental.equipmentId, booking_id: rental.bookingId, lat: 1, lng: 1 })
            .expect(403);
    });

    test('a hardware tracker needs the device secret and a trackable booking for that equipment', async () => {
        const rental = await confirmedRental();
        const renterSocket = await renterWatching(rental);
        const deviceId = `test-device-${Date.now()}`;
        const body = {
            device_id: deviceId,
            equipment_id: rental.equipmentId,
            booking_id: rental.bookingId,
            lat: 14.7102,
            lng: 77.6305,
            speed: 20,
        };
        const previous = process.env.TRACKING_DEVICE_SECRET;
        try {
            delete process.env.TRACKING_DEVICE_SECRET;
            await request(getApp()).post('/api/v1/tracking/device-update').set('x-device-secret', 'anything').send(body).expect(503);

            process.env.TRACKING_DEVICE_SECRET = 'test-device-secret-0123456789abcdef';
            await request(getApp()).post('/api/v1/tracking/device-update').send(body).expect(401);
            await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', 'wrong-secret-0123456789abcdef00')
                .send(body)
                .expect(401);
            await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', process.env.TRACKING_DEVICE_SECRET)
                .send({ ...body, device_id: `${deviceId}-a`, lat: 'north' })
                .expect(400);

            const other = await createEquipment(rental.owner.id, { dailyRate: 500, deposit: 0 });
            await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', process.env.TRACKING_DEVICE_SECRET)
                .send({ ...body, device_id: `${deviceId}-b`, equipment_id: other })
                .expect(404);

            const received = nextEvent(renterSocket, 'location_update');
            const ok = await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', process.env.TRACKING_DEVICE_SECRET)
                .send(body)
                .expect(200);
            expect(ok.body.data).toMatchObject({ source: 'vehicle_gps', bookingId: rental.bookingId });
            expect(await received).toMatchObject({ source: 'vehicle_gps', latitude: 14.7102, longitude: 77.6305 });

            await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', process.env.TRACKING_DEVICE_SECRET)
                .send(body)
                .expect(429);

            // Once the rental is cancelled the tracker's positions are no longer accepted.
            await request(getApp())
                .patch(`/api/v1/bookings/${rental.bookingId}/cancel`)
                .set('Cookie', rental.renterCookie)
                .send({})
                .expect(200);
            await request(getApp())
                .post('/api/v1/tracking/device-update')
                .set('x-device-secret', process.env.TRACKING_DEVICE_SECRET)
                .send({ ...body, device_id: `${deviceId}-c` })
                .expect(422);
        } finally {
            if (previous === undefined) delete process.env.TRACKING_DEVICE_SECRET;
            else process.env.TRACKING_DEVICE_SECRET = previous;
        }
    });
});

describe('equipment chat delivery', () => {
    test("a renter's message reaches only the owner's socket, as chat:message", async () => {
        const owner = await createUser('owner');
        const renter = await createUser('farmer');
        const equipmentId = await createEquipment(owner.id, { dailyRate: 900, deposit: 0 });
        const [ownerCookie, renterCookie] = await Promise.all([sessionCookie(owner), sessionCookie(renter)]);
        const ownerConnection = await connect('/notifications', { cookie: ownerCookie });
        const renterConnection = await connect('/notifications', { cookie: renterCookie });
        expect([ownerConnection.error, renterConnection.error]).toEqual([null, null]);

        const chat = await request(getApp())
            .post('/api/v1/messages/chat/init')
            .set('Cookie', renterCookie)
            .send({ equipment_id: equipmentId })
            .expect(201);
        const chatId = chat.body.data.chat_id;

        const toOwner = nextEvent(ownerConnection.socket, 'chat:message');
        const toRenter = nextEvent(renterConnection.socket, 'chat:message', 1000);
        await request(getApp())
            .post(`/api/v1/messages/chat/${chatId}`)
            .set('Cookie', renterCookie)
            .send({ content: 'Is the tractor free on Monday?' })
            .expect(201);

        expect(await toOwner).toMatchObject({
            chat_id: chatId,
            message: { content: 'Is the tractor free on Monday?', sender_id: renter.id },
        });
        expect(await toRenter).toBeNull();
    });
});
