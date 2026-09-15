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
