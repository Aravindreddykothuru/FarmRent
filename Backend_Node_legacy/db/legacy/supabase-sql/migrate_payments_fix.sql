-- Run this in Supabase Dashboard → SQL Editor
-- Fixes the payments table so real Razorpay UPI payments work end-to-end

-- 1. Drop the broken auth.users FK (custom JWT auth, not Supabase Auth)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;

-- 2. Make user_id nullable + reference custom users table
ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 3. Add missing refund columns
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_amount_paise INTEGER;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason TEXT;

-- 4. Fix status CHECK to include 'refunded'
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'));

-- 5. Ensure booking_id column exists with FK
ALTER TABLE payments ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;

-- Done. Payments table is now compatible with real Razorpay UPI flow.
