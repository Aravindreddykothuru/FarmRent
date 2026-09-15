const schemas = require('../../validations/schemas');
const roles = require('../../lib/roles');

const EQUIPMENT_ID = '5b6d8c1e-0001-4a3b-9c2d-000000000001';
const issues = (result) => result.error.issues.map((i) => i.path.join('.'));

describe('roles', () => {
    test('normalises legacy names and rejects unknown ones', () => {
        expect(roles.normalizeRole('equipment_owner')).toBe('owner');
        expect(roles.normalizeRole(' Farmer ')).toBe('farmer');
        expect(roles.normalizeRole('superuser')).toBeNull();
        expect(roles.normalizeRole(undefined)).toBeNull();
    });

    test('orders roles so the highest privilege is primary and removes duplicates', () => {
        expect(roles.sortRoles(['farmer', 'admin', 'equipment_owner', 'owner'])).toEqual(['admin', 'owner', 'farmer']);
    });

    test('reads role names from a users row with the user_roles embed', () => {
        const row = {
            user_roles: [
                { role_id: 1, roles: { name: 'farmer' } },
                { role_id: 3, roles: { name: 'owner' } },
            ],
        };
        expect(roles.rolesFromUserRow(row)).toEqual(['owner', 'farmer']);
        expect(roles.rolesFromUserRow({})).toEqual([]);
    });

    test('ids match the roles seeded by the baseline migration', () => {
        expect(roles.ROLE_IDS).toEqual({ farmer: 1, buyer: 2, owner: 3, admin: 4, driver: 5 });
    });
});

describe('registerSchema', () => {
    const valid = { email: '  Raju@Farm.IN ', password: 'Abcd123!', name: 'Raju', phone: '9876543210', role: 'owner' };

    test('normalises the email', () => {
        expect(schemas.registerSchema.parse(valid).email).toBe('raju@farm.in');
    });

    test('never lets a client register as admin', () => {
        expect(schemas.registerSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    });

    test('enforces password strength and a valid mobile number', () => {
        const result = schemas.registerSchema.safeParse({ ...valid, password: 'short', phone: '12345' });
        expect(issues(result)).toEqual(expect.arrayContaining(['password', 'phone']));
    });
});

describe('bookingCreateSchema', () => {
    test('accepts the web client payload and ignores client-side amounts', () => {
        const parsed = schemas.bookingCreateSchema.parse({
            machineId: EQUIPMENT_ID,
            startDate: '2030-01-10',
            endDate: '2030-01-12',
            totalAmount: 1,
            promoDiscount: 99999,
            paymentMethod: 'cod',
            promoCode: 'farm100',
        });
        expect(parsed).toMatchObject({
            equipment_id: EQUIPMENT_ID,
            start_date: '2030-01-10',
            end_date: '2030-01-12',
            payment_method: 'cod',
            promo_code: 'FARM100',
            delivery_mode: 'pickup',
        });
        expect(parsed).not.toHaveProperty('total_amount');
        expect(parsed).not.toHaveProperty('totalAmount');
        expect(parsed).not.toHaveProperty('promoDiscount');
    });

    test('rejects impossible calendar dates and missing fields', () => {
        expect(
            issues(schemas.bookingCreateSchema.safeParse({ equipment_id: EQUIPMENT_ID, start_date: '2030-02-30', end_date: '2030-03-01' })),
        ).toContain('start_date');
        expect(schemas.bookingCreateSchema.safeParse({ start_date: '2030-01-01', end_date: '2030-01-02' }).success).toBe(false);
    });

    test('requires an address for delivery', () => {
        const result = schemas.bookingCreateSchema.safeParse({
            equipment_id: EQUIPMENT_ID,
            start_date: '2030-01-10',
            end_date: '2030-01-12',
            deliveryMode: 'delivery',
        });
        expect(issues(result)).toContain('field_address');
    });
});

describe('offerRespondSchema', () => {
    test('maps the web client verbs to stored statuses', () => {
        expect(schemas.offerRespondSchema.parse({ action: 'accept' }).action).toBe('accepted');
        expect(schemas.offerRespondSchema.parse({ action: 'reject' }).action).toBe('rejected');
        expect(schemas.offerRespondSchema.parse({ action: 'counter', counter_price: '900' })).toMatchObject({
            action: 'countered',
            counter_price: 900,
        });
    });

    test('a counter offer needs a price', () => {
        expect(schemas.offerRespondSchema.safeParse({ action: 'counter' }).success).toBe(false);
    });
});

describe('machine schemas', () => {
    const listing = {
        name: 'Mahindra 575',
        type: 'Tractor',
        pricing: { baseRatePerDay: '1800' },
        location: { district: 'Anantapur', coordinates: { type: 'Point', coordinates: [77.6, 14.68] } },
        pickup_lat: 14.68,
        pickup_lng: 77.6,
    };

    test('accepts the add-equipment payload and coerces the rate', () => {
        const parsed = schemas.machineCreateSchema.parse(listing);
        expect(parsed.type).toBe('tractor');
        expect(parsed.pricing.baseRatePerDay).toBe(1800);
    });

    test('pickup coordinates must come as a pair', () => {
        expect(schemas.machineCreateSchema.safeParse({ ...listing, pickup_lng: undefined }).success).toBe(false);
    });

    test('rejects a non-positive rate and out-of-range coordinates', () => {
        expect(schemas.machineCreateSchema.safeParse({ ...listing, pricing: { baseRatePerDay: 0 } }).success).toBe(false);
        expect(schemas.machineCreateSchema.safeParse({ ...listing, location: { coordinates: { coordinates: [200, 14] } } }).success).toBe(
            false,
        );
    });

    test('updates may be partial', () => {
        expect(schemas.machineUpdateSchema.parse({ pricing: { baseRatePerDay: 2000 } })).toEqual({ pricing: { baseRatePerDay: 2000 } });
    });
});

describe('address, preference and extension schemas', () => {
    test('address requires a six-digit pincode', () => {
        const address = { name: 'Home', address_line1: '123 Farm Road', city: 'Anantapur', state: 'Andhra Pradesh', pincode: '515001' };
        expect(schemas.addressCreateSchema.safeParse(address).success).toBe(true);
        expect(schemas.addressCreateSchema.safeParse({ ...address, name: '', pincode: 'abc123' }).success).toBe(false);
    });

    test('notification preferences are booleans', () => {
        expect(schemas.notificationPreferenceSchema.safeParse({ email: true, sms: false, push: true }).success).toBe(true);
        expect(schemas.notificationPreferenceSchema.safeParse({ email: 'yes' }).success).toBe(false);
    });

    test('extension end date must be a real calendar date', () => {
        expect(schemas.bookingExtensionCreateSchema.safeParse({ new_end_date: '2030-07-15', reason: 'Harvest' }).success).toBe(true);
        expect(schemas.bookingExtensionCreateSchema.safeParse({ new_end_date: 'invalid-date-format' }).success).toBe(false);
    });
});
