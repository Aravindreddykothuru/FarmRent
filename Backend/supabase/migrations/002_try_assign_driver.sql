-- Migration: Atomic driver assignment to prevent double-booking race conditions
-- Run this in: Supabase Dashboard → SQL Editor → New Query

CREATE OR REPLACE FUNCTION try_assign_driver(p_driver_id UUID, p_booking_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
    -- Advisory lock keyed on driver UUID — prevents concurrent assignment of same driver
    PERFORM pg_try_advisory_xact_lock(hashtext(p_driver_id::text));

    -- Verify driver is still available inside the lock
    IF NOT EXISTS (
        SELECT 1 FROM drivers WHERE id = p_driver_id AND is_available = true
    ) THEN
        RETURN FALSE;
    END IF;

    -- Atomically mark driver unavailable and link to booking
    UPDATE drivers  SET is_available = false           WHERE id = p_driver_id;
    UPDATE bookings SET driver_id    = p_driver_id     WHERE id = p_booking_id;
    RETURN TRUE;
END;
$$;
