const request = require('supertest');
const { getApp, resetRateLimits, isoDate, createUser, login, createEquipment, withDb } = require('./helpers');

const book = (agent, equipmentId, start, end, extra = {}) =>
    agent.post('/api/v1/bookings').send({ machineId: equipmentId, startDate: start, endDate: end, paymentMethod: 'cod', ...extra });

describe('bookings', () => {
    let owner;
    let ownerAgent;
    let renter;
    let renterAgent;
    let otherRenter;
    let otherAgent;
    let stranger;
    let strangerAgent;
    let equipmentId;

    beforeAll(async () => {
        await resetRateLimits();
        owner = await createUser('owner', 'Owner Ravi');
        renter = await createUser('farmer', 'Renter Suresh');
        otherRenter = await createUser('farmer', 'Renter Meena');
        stranger = await createUser('farmer', 'Stranger');
        [ownerAgent, renterAgent, otherAgent, strangerAgent] = await Promise.all([owner, renter, otherRenter, stranger].map(login));
        equipmentId = await createEquipment(owner.id, { dailyRate: 1000, deposit: 500 });
    });

    beforeEach(() => resetRateLimits());

    test('quote and booking use the same server-side price; client amounts are ignored', async () => {
        const [start, end] = [isoDate(40), isoDate(42)];
        const quote = await request(getApp())
            .get(`/api/v1/bookings/quote?equipment_id=${equipmentId}&start_date=${start}&end_date=${end}&delivery_mode=delivery`)
            .expect(200);
        // 3 days × ₹1000 + 3% fee + ₹500 deposit + ₹500 delivery
        expect(quote.body.data).toMatchObject({
            days: 3,
            subtotal: 3000,
            serviceFee: 90,
            deposit: 500,
            deliveryCharge: 500,
            total: 4090,
            available: true,
        });

        const res = await book(renterAgent, equipmentId, start, end, {
            totalAmount: 1,
            deliveryMode: 'delivery',
            fieldAddress: 'Survey 45, Rampur',
        }).expect(201);
        expect(res.body.data).toMatchObject({
            status: 'pending',
            total_amount: 4090,
            totalDays: 3,
            renter_id: renter.id,
            owner_id: owner.id,
        });
        // Contact details and the pickup point stay private until the owner accepts.
        expect(res.body.data.owner).not.toHaveProperty('phone');
        expect(res.body.data.pickup).toBeNull();
    });

    test('an overlapping request for the same equipment is rejected by the server', async () => {
        const res = await book(otherAgent, equipmentId, isoDate(42), isoDate(44)).expect(409);
        expect(res.body.error.code).toBe('BOOKING_CONFLICT');

        const availability = await request(getApp()).get(`/api/v1/bookings/availability/${equipmentId}`).expect(200);
        expect(availability.body.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ start_date: isoDate(40), end_date: isoDate(42) })]),
        );

        // Adjacent dates do not overlap.
        await book(otherAgent, equipmentId, isoDate(43), isoDate(43)).expect(201);
    });

    test('two concurrent requests for the same free dates: exactly one wins', async () => {
        const [start, end] = [isoDate(60), isoDate(61)];
        const results = await Promise.all([book(renterAgent, equipmentId, start, end), book(otherAgent, equipmentId, start, end)]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);

        const { rows } = await withDb((db) =>
            db.query(
                `SELECT count(*)::int AS n FROM equipment_rentals WHERE equipment_id = $1 AND start_date = $2 AND status = 'requested'`,
                [equipmentId, start],
            ),
        );
        expect(rows[0].n).toBe(1);
    });

    test('invalid requests are 4xx, never 500', async () => {
        // The booking limiter (3 requests/minute per user) counts rejected attempts too, so reset between cases.
        const attempt = async (...args) => {
            await resetRateLimits();
            return book(...args);
        };
        expect((await attempt(renterAgent, equipmentId, isoDate(-1), isoDate(1))).body.error.code).toBe('START_DATE_IN_PAST');
        expect((await attempt(renterAgent, equipmentId, isoDate(50), isoDate(49))).body.error.code).toBe('INVALID_DATE_RANGE');
        expect((await attempt(renterAgent, equipmentId, isoDate(50), isoDate(150))).body.error.code).toBe('RENTAL_TOO_LONG');
        expect((await attempt(renterAgent, 'not-a-uuid', isoDate(50), isoDate(51))).body.error.code).toBe('VALIDATION_ERROR');
        expect((await attempt(renterAgent, '00000000-0000-4000-8000-000000000000', isoDate(50), isoDate(51))).body.error.code).toBe(
            'EQUIPMENT_NOT_FOUND',
        );
        expect((await attempt(renterAgent, equipmentId, isoDate(50), isoDate(51), { promoCode: 'NOPE' })).body.error.code).toBe(
            'PROMO_INVALID',
        );
        expect((await attempt(ownerAgent, equipmentId, isoDate(50), isoDate(51))).status).toBe(403);
        await request(getApp())
            .post('/api/v1/bookings')
            .send({ machineId: equipmentId, startDate: isoDate(50), endDate: isoDate(51) })
            .expect(401);
    });

    test('the booking limiter stops a burst of requests from one user', async () => {
        const statuses = [];
        for (let i = 0; i < 4; i += 1) {
            statuses.push((await book(otherAgent, equipmentId, isoDate(-1), isoDate(1))).status);
        }
        expect(statuses).toEqual([400, 400, 400, 429]);
    });

    test('full lifecycle: request → confirm → hand over → return → complete, with role checks at every step', async () => {
        const created = (await book(renterAgent, equipmentId, isoDate(70), isoDate(72)).expect(201)).body.data;
        const path = `/api/v1/bookings/${created.id}`;

        // Visibility: parties see it, anyone else gets 404.
        await strangerAgent.get(path).expect(404);
        await strangerAgent.patch(`${path}/cancel`).expect(404);

        // Only the owner can confirm.
        expect((await renterAgent.patch(`${path}/accept`).expect(403)).body.error.code).toBe('FORBIDDEN');
        const accepted = (await ownerAgent.patch(`${path}/accept`).expect(200)).body.data;
        expect(accepted.status).toBe('confirmed');
        expect(accepted.owner.phone).toBeTruthy();
        expect(accepted.pickup).toMatchObject({ address: 'Owner yard, Anantapur' });
        expect((await ownerAgent.patch(`${path}/accept`).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
        expect((await renterAgent.get(path).expect(200)).body.data.status).toBe('confirmed');

        // No completion code before hand-over; hand-over is the owner's action.
        await renterAgent.get(`${path}/completion-otp`).expect(409);
        await renterAgent.patch(`${path}/start`).expect(403);
        expect((await ownerAgent.patch(`${path}/start`).expect(200)).body.data.status).toBe('in_progress');

        // An in-use rental cannot be cancelled.
        await renterAgent.patch(`${path}/cancel`).expect(409);

        const { otp } = (await renterAgent.get(`${path}/completion-otp`).expect(200)).body.data;
        await ownerAgent.get(`${path}/completion-otp`).expect(403);
        expect((await ownerAgent.post(`${path}/complete`).send({}).expect(400)).body.error.code).toBe('OTP_REQUIRED');
        const wrongOtp = String((Number(otp) + 1) % 1000000).padStart(6, '0');
        expect((await ownerAgent.post(`${path}/complete`).send({ otp: wrongOtp }).expect(400)).body.error.code).toBe('INVALID_OTP');

        await ownerAgent.post(`${path}/return`).expect(403);
        const returning = (await renterAgent.post(`${path}/return`).expect(200)).body.data;
        expect(returning).toMatchObject({ status: 'return_pending', completion_otp: otp });

        expect((await ownerAgent.post(`${path}/complete`).send({ otp }).expect(200)).body.data.status).toBe('completed');
        await ownerAgent.post(`${path}/complete`).send({ otp }).expect(409);

        // Timestamps recorded for each step.
        const { rows } = await withDb((db) =>
            db.query(
                'SELECT accepted_at, started_at, return_requested_at, completed_at, updated_at > created_at AS touched FROM equipment_rentals WHERE id = $1',
                [created.id],
            ),
        );
        expect(rows[0]).toMatchObject({ touched: true });
        expect(rows[0].accepted_at && rows[0].started_at && rows[0].return_requested_at && rows[0].completed_at).toBeTruthy();

        // A completed rental no longer holds its dates.
        await book(otherAgent, equipmentId, isoDate(71), isoDate(71)).expect(201);

        // Review allowed once, only by the renter, only after completion.
        await ownerAgent.post('/api/v1/reviews').send({ bookingId: created.id, rating: 5 }).expect(403);
        await renterAgent.post('/api/v1/reviews').send({ bookingId: created.id, rating: 4, comment: 'Worked well' }).expect(201);
        await renterAgent.post('/api/v1/reviews').send({ bookingId: created.id, rating: 4 }).expect(409);
    });

    test('cancelling frees the dates; declining is the owner-only exit from a request', async () => {
        const [start, end] = [isoDate(80), isoDate(81)];
        const first = (await book(renterAgent, equipmentId, start, end).expect(201)).body.data;
        await book(otherAgent, equipmentId, start, end).expect(409);

        expect(
            (await renterAgent.patch(`/api/v1/bookings/${first.id}/cancel`).send({ reason: 'Plans changed' }).expect(200)).body.data.status,
        ).toBe('cancelled');
        const second = (await book(otherAgent, equipmentId, start, end).expect(201)).body.data;

        await otherAgent.patch(`/api/v1/bookings/${second.id}/reject`).expect(403);
        expect((await ownerAgent.patch(`/api/v1/bookings/${second.id}/reject`).expect(200)).body.data.status).toBe('rejected');
    });

    test('booking history is scoped to each party', async () => {
        const mine = (await renterAgent.get('/api/v1/bookings/my?status=all&limit=100').expect(200)).body.data;
        expect(mine.bookings.length).toBeGreaterThan(0);
        expect(mine.bookings.every((b) => b.renter_id === renter.id)).toBe(true);
        expect(mine.total).toBeGreaterThanOrEqual(mine.bookings.length);

        const incoming = (await ownerAgent.get('/api/v1/bookings/incoming?status=all&limit=100').expect(200)).body.data;
        expect(incoming.bookings.every((b) => b.owner_id === owner.id)).toBe(true);
        expect(incoming.bookings.length).toBeGreaterThanOrEqual(mine.bookings.length);

        expect((await strangerAgent.get('/api/v1/bookings/incoming?status=all').expect(200)).body.data.bookings).toEqual([]);
        expect((await ownerAgent.get('/api/v1/bookings/my').expect(200)).body.data.bookings).toEqual([]);

        const pending = (await ownerAgent.get('/api/v1/bookings/incoming?status=pending').expect(200)).body.data;
        expect(pending.bookings.every((b) => b.status === 'pending')).toBe(true);
        await ownerAgent.get('/api/v1/bookings/incoming?status=bogus').expect(400);
    });

    test('messages on a booking are limited to its renter and owner', async () => {
        const created = (await book(renterAgent, equipmentId, isoDate(90), isoDate(90)).expect(201)).body.data;
        await renterAgent.post(`/api/v1/messages/${created.id}`).send({ content: 'Is it fuelled?' }).expect(201);
        const thread = (await ownerAgent.get(`/api/v1/messages/${created.id}`).expect(200)).body.data.messages;
        expect(thread.map((m) => m.content)).toContain('Is it fuelled?');
        await strangerAgent.get(`/api/v1/messages/${created.id}`).expect(404);
        await strangerAgent.post(`/api/v1/messages/${created.id}`).send({ content: 'hi' }).expect(404);
        await renterAgent.get('/api/v1/messages/chats').expect(200);
    });
});
