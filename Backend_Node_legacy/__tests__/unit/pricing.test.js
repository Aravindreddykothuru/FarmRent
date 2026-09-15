const pricing = require('../../services/booking-service/pricing');

const NOW = new Date('2030-01-01T10:00:00Z');
const promo = (overrides = {}) => ({
    code: 'TEST',
    is_active: true,
    discount_type: 'flat',
    discount_value: 100,
    min_order_value: 0,
    max_discount: null,
    usage_limit: null,
    used_count: 0,
    expires_at: null,
    ...overrides,
});

function errorOf(fn) {
    try {
        fn();
    } catch (err) {
        return { status: err.statusCode, code: err.code };
    }
    return null;
}

describe('rentalDays', () => {
    test('counts both the start and end day', () => {
        expect(pricing.rentalDays('2030-01-10', '2030-01-10')).toBe(1);
        expect(pricing.rentalDays('2030-01-10', '2030-01-12')).toBe(3);
        expect(pricing.rentalDays('2030-02-27', '2030-03-01')).toBe(3);
    });
});

describe('quoteRental', () => {
    test('prices days × daily rate plus the 3% service fee', () => {
        expect(pricing.quoteRental({ dailyRate: '1800.00', startDate: '2030-01-10', endDate: '2030-01-12', now: NOW })).toEqual({
            days: 3,
            dailyRate: 1800,
            subtotal: 5400,
            serviceFee: 162,
            deposit: 0,
            deliveryCharge: 0,
            discount: 0,
            total: 5562,
        });
    });

    test('adds the security deposit and the delivery charge when delivery is requested', () => {
        expect(
            pricing.quoteRental({
                dailyRate: 1000,
                startDate: '2030-01-10',
                endDate: '2030-01-11',
                deposit: '2500',
                deliveryMode: 'delivery',
                now: NOW,
            }),
        ).toMatchObject({ subtotal: 2000, serviceFee: 60, deposit: 2500, deliveryCharge: 500, total: 5060 });
    });

    test('rounds the service fee to the rupee like the booking page', () => {
        expect(pricing.quoteRental({ dailyRate: 1150, startDate: '2030-01-10', endDate: '2030-01-10', now: NOW }).serviceFee).toBe(35);
    });

    test('allows a booking that starts today', () => {
        expect(pricing.quoteRental({ dailyRate: 500, startDate: '2030-01-01', endDate: '2030-01-01', now: NOW }).total).toBe(515);
    });

    test.each([
        ['start in the past', { startDate: '2029-12-31', endDate: '2030-01-02' }, 400, 'START_DATE_IN_PAST'],
        ['end before start', { startDate: '2030-01-05', endDate: '2030-01-04' }, 400, 'INVALID_DATE_RANGE'],
        ['longer than 90 days', { startDate: '2030-01-01', endDate: '2030-04-01' }, 400, 'RENTAL_TOO_LONG'],
        ['no valid daily rate', { startDate: '2030-01-01', endDate: '2030-01-02', dailyRate: 0 }, 409, 'EQUIPMENT_NOT_PRICED'],
    ])('rejects %s', (_label, input, status, code) => {
        expect(errorOf(() => pricing.quoteRental({ dailyRate: 1000, now: NOW, ...input }))).toEqual({ status, code });
    });

    test('exactly 90 days is allowed', () => {
        expect(pricing.quoteRental({ dailyRate: 10, startDate: '2030-01-01', endDate: '2030-03-31', now: NOW }).days).toBe(90);
    });
});

describe('promoDiscount', () => {
    test('flat discount', () => {
        expect(pricing.promoDiscount(promo(), 5400, NOW)).toBe(100);
    });

    test('percentage discount is capped by max_discount', () => {
        expect(pricing.promoDiscount(promo({ discount_type: 'percent', discount_value: 10 }), 5400, NOW)).toBe(540);
        expect(pricing.promoDiscount(promo({ discount_type: 'percent', discount_value: 10, max_discount: 300 }), 5400, NOW)).toBe(300);
    });

    test('never discounts more than the subtotal', () => {
        expect(pricing.promoDiscount(promo({ discount_value: 1000 }), 400, NOW)).toBe(400);
    });

    test('rounds to paise', () => {
        expect(pricing.promoDiscount(promo({ discount_type: 'percent', discount_value: 7.5 }), 333, NOW)).toBe(24.98);
    });

    test.each([
        ['missing', null, 404, 'PROMO_INVALID'],
        ['inactive', promo({ is_active: false }), 404, 'PROMO_INVALID'],
        ['expired', promo({ expires_at: '2029-12-31T00:00:00Z' }), 400, 'PROMO_EXPIRED'],
        ['exhausted', promo({ usage_limit: 5, used_count: 5 }), 400, 'PROMO_EXHAUSTED'],
        ['below the minimum', promo({ min_order_value: 10000 }), 400, 'PROMO_MINIMUM_NOT_MET'],
    ])('rejects a %s code', (_label, code, status, errorCode) => {
        expect(errorOf(() => pricing.promoDiscount(code, 5400, NOW))).toEqual({ status, code: errorCode });
    });

    test('the quote subtracts the discount from the full total', () => {
        expect(
            pricing.quoteRental({ dailyRate: 1800, startDate: '2030-01-10', endDate: '2030-01-12', promo: promo(), now: NOW }),
        ).toMatchObject({ subtotal: 5400, serviceFee: 162, discount: 100, total: 5462 });
    });
});

describe('extensionCharge', () => {
    test('charges extra days plus the service fee on them', () => {
        expect(pricing.extensionCharge('1800', 2)).toBe(3708);
    });
});
