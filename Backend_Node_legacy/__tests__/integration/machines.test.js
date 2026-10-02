const request = require('supertest');
const { getApp, resetRateLimits, isoDate, createUser, login } = require('./helpers');

const listing = {
    name: 'Swaraj 855 FE',
    type: 'tractor',
    description: 'Well maintained 52 HP tractor',
    pricing: { baseRatePerDay: 1500, securityDeposit: 1000 },
    location: {
        village: 'Rampur',
        district: 'Guntur',
        state: 'Andhra Pradesh',
        pincode: '522001',
        coordinates: { type: 'Point', coordinates: [80.4365, 16.3067] },
    },
    pickup_lat: 16.307,
    pickup_lng: 80.437,
    pickup_address: 'Behind the grain market',
    pickup_landmark: 'Water tank',
    service_radius_km: 40,
    images: ['https://images.unsplash.com/photo-1560493676-04071c5f467b'],
    features: ['Power steering'],
    specifications: { power: '52 HP' },
};

describe('equipment listings (/api/v1/machines)', () => {
    let owner;
    let ownerAgent;
    let strangerAgent;
    let renterAgent;
    let machineId;

    beforeAll(async () => {
        await resetRateLimits();
        owner = await createUser('owner');
        [ownerAgent, strangerAgent, renterAgent] = await Promise.all(
            [owner, await createUser('owner'), await createUser('farmer')].map(login),
        );
    });

    beforeEach(() => resetRateLimits());

    test('an owner creates a listing; the pickup point is only visible to them', async () => {
        const created = (await ownerAgent.post('/api/v1/machines').send(listing).expect(201)).body.data;
        machineId = created.id;
        expect(created).toMatchObject({
            name: listing.name,
            type: 'tractor',
            status: 'available',
            owner_id: owner.id,
            pricing: { baseRatePerDay: 1500, securityDeposit: 1000 },
            location: { district: 'Guntur', pincode: '522001', coordinates: { coordinates: [80.4365, 16.3067] } },
            features: ['Power steering'],
            pickup: { address: 'Behind the grain market' },
        });

        const publicView = (await request(getApp()).get(`/api/v1/machines/${machineId}`).expect(200)).body.data;
        expect(publicView).not.toHaveProperty('pickup');
        expect(publicView.name).toBe(listing.name);
    });

    test('listings are searchable and filterable', async () => {
        const byText = (await request(getApp()).get('/api/v1/machines?q=Swaraj').expect(200)).body.data;
        expect(byText.map((m) => m.id)).toContain(machineId);

        const byType = (await request(getApp()).get('/api/v1/machines?type=combine-harvester').expect(200)).body.data;
        expect(byType.map((m) => m.id)).not.toContain(machineId);

        const search = (await request(getApp()).get('/api/v1/search/machines?district=Guntur&type=tractor').expect(200)).body.data;
        expect(search.machines.map((m) => m.id)).toContain(machineId);

        const nearby = (await request(getApp()).get('/api/v1/machines/nearby?lat=16.30&lng=80.43&radius=10').expect(200)).body.data;
        expect(nearby.map((m) => m.id)).toContain(machineId);

        // Filter syntax characters in free text cannot break the query.
        await request(getApp()).get('/api/v1/machines?q=a,b).or(id.eq.1').expect(200);

        const mine = (await ownerAgent.get('/api/v1/machines?owner=me').expect(200)).body.data;
        expect(mine.every((m) => m.owner_id === owner.id)).toBe(true);
        await request(getApp()).get('/api/v1/machines?owner=me').expect(401);
    });

    test('validation errors are 400 with field details', async () => {
        const res = await ownerAgent
            .post('/api/v1/machines')
            .send({ ...listing, pricing: { baseRatePerDay: 0 }, pickup_lng: undefined })
            .expect(400);
        expect(res.body.error.details.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['pricing.baseRatePerDay', 'pickup_lat']));
        await request(getApp()).post('/api/v1/machines').send(listing).expect(401);
        await request(getApp()).get('/api/v1/machines/not-a-uuid').expect(404);
    });

    test('only the owner can edit or remove a listing', async () => {
        await strangerAgent
            .patch(`/api/v1/machines/${machineId}`)
            .send({ pricing: { baseRatePerDay: 1 } })
            .expect(403);
        const updated = (
            await ownerAgent
                .patch(`/api/v1/machines/${machineId}`)
                .send({ pricing: { baseRatePerDay: 1600 } })
                .expect(200)
        ).body.data;
        expect(updated.pricing.baseRatePerDay).toBe(1600);
        await strangerAgent.delete(`/api/v1/machines/${machineId}`).expect(403);
    });

    test('a listing with a live booking cannot be removed; once free it is soft-deleted', async () => {
        const booking = (
            await renterAgent
                .post('/api/v1/bookings')
                .send({ machineId, startDate: isoDate(20), endDate: isoDate(21), paymentMethod: 'cod' })
                .expect(201)
        ).body.data;
        expect(booking.total_amount).toBe(1600 * 2 + Math.round(3200 * 0.03) + 1000);

        expect((await ownerAgent.delete(`/api/v1/machines/${machineId}`).expect(409)).body.error.code).toBe('HAS_ACTIVE_BOOKINGS');
        await renterAgent.patch(`/api/v1/bookings/${booking.id}/cancel`).expect(200);

        await ownerAgent.delete(`/api/v1/machines/${machineId}`).expect(204);
        await request(getApp()).get(`/api/v1/machines/${machineId}`).expect(404);
        const list = (await request(getApp()).get('/api/v1/machines?q=Swaraj').expect(200)).body.data;
        expect(list.map((m) => m.id)).not.toContain(machineId);

        // Rental history still points at the listing.
        const history = (await renterAgent.get(`/api/v1/bookings/${booking.id}`).expect(200)).body.data;
        expect(history.machineId).toBe(machineId);
    });
});
