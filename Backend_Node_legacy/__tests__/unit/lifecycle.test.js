const lifecycle = require('../../services/booking-service/lifecycle');

const OWNER = { id: 'owner-1', roles: ['owner'] };
const RENTER = { id: 'renter-1', roles: ['farmer'] };
const STRANGER = { id: 'someone-else', roles: ['farmer'] };
const ADMIN = { id: 'admin-1', roles: ['admin'] };

const booking = (status, extra = {}) => ({
    id: 'b0b0b0b0-0000-4000-8000-000000000001',
    renter_id: RENTER.id,
    owner_id: OWNER.id,
    driver_id: 'driver-1',
    status,
    started_at: '2030-01-10T08:00:00.000Z',
    ...extra,
});

function attempt(action, status, user, driverId = null) {
    const b = booking(status);
    try {
        const rule = lifecycle.assertTransition(action, b, lifecycle.relationsTo(b, user, driverId));
        return { ok: true, to: rule.to };
    } catch (err) {
        return { ok: false, status: err.statusCode, code: err.code };
    }
}

describe('relationsTo', () => {
    test('identifies renter, owner, driver and admin', () => {
        expect([...lifecycle.relationsTo(booking('requested'), RENTER)]).toEqual(['renter']);
        expect([...lifecycle.relationsTo(booking('requested'), OWNER)]).toEqual(['owner']);
        expect([...lifecycle.relationsTo(booking('requested'), STRANGER, 'driver-1')]).toEqual(['driver']);
        expect([...lifecycle.relationsTo(booking('requested'), ADMIN)]).toEqual(['admin']);
        expect(lifecycle.relationsTo(booking('requested'), STRANGER).size).toBe(0);
    });
});

describe('assertTransition — the rental state machine', () => {
    test.each([
        // action,    from,             actor,   result
        ['accept', 'requested', OWNER, 'approved'],
        ['reject', 'requested', OWNER, 'rejected'],
        ['cancel', 'requested', RENTER, 'cancelled'],
        ['cancel', 'approved', OWNER, 'cancelled'],
        ['start', 'approved', OWNER, 'active'],
        ['return', 'active', RENTER, 'return_pending'],
        ['complete', 'active', OWNER, 'completed'],
        ['complete', 'return_pending', OWNER, 'completed'],
        ['accept', 'requested', ADMIN, 'approved'],
    ])('%s from %s by %p → %s', (action, from, actor, to) => {
        expect(attempt(action, from, actor)).toEqual({ ok: true, to });
    });

    test('the driver assigned to a booking may start and complete it', () => {
        expect(attempt('start', 'approved', STRANGER, 'driver-1')).toEqual({ ok: true, to: 'active' });
        expect(attempt('complete', 'active', STRANGER, 'driver-1')).toEqual({ ok: true, to: 'completed' });
    });

    test.each([
        ['accept', 'requested', RENTER],
        ['reject', 'requested', RENTER],
        ['start', 'approved', RENTER],
        ['complete', 'active', RENTER],
        ['return', 'active', OWNER],
        ['cancel', 'requested', STRANGER],
    ])('%s from %s by the wrong party is 403', (action, from, actor) => {
        expect(attempt(action, from, actor)).toEqual({ ok: false, status: 403, code: 'FORBIDDEN' });
    });

    test.each([
        ['accept', 'approved'],
        ['accept', 'cancelled'],
        ['start', 'requested'],
        ['cancel', 'active'],
        ['cancel', 'completed'],
        ['complete', 'approved'],
        ['complete', 'completed'],
        ['reject', 'approved'],
    ])('%s from %s is 409 (illegal state change)', (action, from) => {
        const actor = action === 'cancel' ? RENTER : OWNER;
        expect(attempt(action, from, actor)).toEqual({ ok: false, status: 409, code: 'INVALID_TRANSITION' });
    });

    test('unknown actions are rejected', () => {
        expect(attempt('teleport', 'requested', ADMIN)).toEqual({ ok: false, status: 400, code: 'UNKNOWN_ACTION' });
    });
});

describe('client status names', () => {
    test('maps stored statuses to the names the web client renders and back', () => {
        expect(lifecycle.toClientStatus('requested')).toBe('pending');
        expect(lifecycle.toClientStatus('approved')).toBe('confirmed');
        expect(lifecycle.toClientStatus('active')).toBe('in_progress');
        expect(lifecycle.toClientStatus('return_pending')).toBe('return_pending');
        expect(lifecycle.toDbStatus('pending')).toBe('requested');
        expect(lifecycle.toDbStatus('in_progress')).toBe('active');
        expect(lifecycle.toDbStatus('completed')).toBe('completed');
    });
});

describe('completion code', () => {
    const secret = 'unit-test-secret';

    test('is a stable six-digit code per booking handover', () => {
        const code = lifecycle.completionOtp(booking('active'), secret);
        expect(code).toMatch(/^\d{6}$/);
        expect(lifecycle.completionOtp(booking('return_pending'), secret)).toBe(code);
        expect(lifecycle.completionOtp(booking('active', { started_at: '2030-01-11T08:00:00.000Z' }), secret)).not.toBe(code);
    });

    test('does not exist before the equipment is handed over', () => {
        expect(lifecycle.completionOtp(booking('approved', { started_at: null }), secret)).toBeNull();
    });

    test('verification accepts only the exact code', () => {
        const b = booking('active');
        const code = lifecycle.completionOtp(b, secret);
        const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
        expect(lifecycle.verifyCompletionOtp(b, code, secret)).toBe(true);
        expect(lifecycle.verifyCompletionOtp(b, wrong, secret)).toBe(false);
        expect(lifecycle.verifyCompletionOtp(b, code.slice(1), secret)).toBe(false);
        expect(lifecycle.verifyCompletionOtp(b, undefined, secret)).toBe(false);
        expect(lifecycle.verifyCompletionOtp(b, code, 'other-secret')).toBe(false);
    });
});
