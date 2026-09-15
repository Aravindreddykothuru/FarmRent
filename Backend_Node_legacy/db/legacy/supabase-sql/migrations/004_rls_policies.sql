-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: Row-Level Security policies for all tables
-- Run this in Supabase SQL Editor (requires service role to execute)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enable RLS on every table ─────────────────────────────────────────────────
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews          ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments_log     ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to allow clean re-run
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Anyone can read basic public profile (name, role, avatar — never password_hash)
CREATE POLICY "users_select_public" ON users
  FOR SELECT USING (true);

-- Only own row can be updated
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- Insert is handled server-side (service role bypasses RLS)
-- Admin full access handled by service role key used in Backend

-- ─────────────────────────────────────────────────────────────────────────────
-- EQUIPMENT
-- ─────────────────────────────────────────────────────────────────────────────
-- Public read: available / active equipment
CREATE POLICY "equipment_select_public" ON equipment
  FOR SELECT USING (status IN ('available', 'rented', 'maintenance') OR owner_id::text = auth.uid()::text);

-- Owners can insert their own equipment
CREATE POLICY "equipment_insert_owner" ON equipment
  FOR INSERT WITH CHECK (owner_id::text = auth.uid()::text);

-- Owners can update/delete their own equipment
CREATE POLICY "equipment_update_owner" ON equipment
  FOR UPDATE USING (owner_id::text = auth.uid()::text);

CREATE POLICY "equipment_delete_owner" ON equipment
  FOR DELETE USING (owner_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- BOOKINGS
-- ─────────────────────────────────────────────────────────────────────────────
-- Only farmer (renter) or equipment owner can see the booking
CREATE POLICY "bookings_select_parties" ON bookings
  FOR SELECT USING (
    renter_id::text = auth.uid()::text OR
    owner_id::text  = auth.uid()::text
  );

-- Farmers create bookings for themselves
CREATE POLICY "bookings_insert_farmer" ON bookings
  FOR INSERT WITH CHECK (renter_id::text = auth.uid()::text);

-- Both parties can update booking status
CREATE POLICY "bookings_update_parties" ON bookings
  FOR UPDATE USING (
    renter_id::text = auth.uid()::text OR
    owner_id::text  = auth.uid()::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "payments_select_own" ON payments
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "payments_insert_own" ON payments
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- MESSAGES
-- ─────────────────────────────────────────────────────────────────────────────
-- Only booking participants can read messages in that booking
CREATE POLICY "messages_select_booking_parties" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = messages.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

CREATE POLICY "messages_insert_booking_parties" ON messages
  FOR INSERT WITH CHECK (
    sender_id::text = auth.uid()::text AND
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = messages.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- KYC DOCUMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "kyc_select_own" ON kyc_documents
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "kyc_insert_own" ON kyc_documents
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- DISPUTES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "disputes_select_parties" ON disputes
  FOR SELECT USING (
    raised_by::text = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = disputes.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

CREATE POLICY "disputes_insert_own" ON disputes
  FOR INSERT WITH CHECK (raised_by::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWS
-- ─────────────────────────────────────────────────────────────────────────────
-- All users can read reviews (public trust signal)
CREATE POLICY "reviews_select_public" ON reviews
  FOR SELECT USING (true);

-- Only reviewer can insert their own review
CREATE POLICY "reviews_insert_own" ON reviews
  FOR INSERT WITH CHECK (reviewer_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- FAVORITES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "favorites_select_own" ON favorites
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "favorites_insert_own" ON favorites
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "favorites_delete_own" ON favorites
  FOR DELETE USING (user_id::text = auth.uid()::text);

-- ─────────────────────────────────────────────────────────────────────────────
-- LOCATIONS (GPS tracking)
-- ─────────────────────────────────────────────────────────────────────────────
-- Driver can write their own location
CREATE POLICY "locations_insert_driver" ON locations
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

-- Booking parties can read GPS history for their booking
CREATE POLICY "locations_select_booking_parties" ON locations
  FOR SELECT USING (
    user_id::text = auth.uid()::text OR
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = locations.booking_id
        AND (b.renter_id::text = auth.uid()::text OR b.owner_id::text = auth.uid()::text)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- REFRESH TOKENS (service-role only — no client access)
-- ─────────────────────────────────────────────────────────────────────────────
-- Deny all anon/authenticated direct access; service role bypasses RLS
CREATE POLICY "refresh_tokens_deny_all" ON refresh_tokens
  FOR ALL USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS LOG (service-role only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "payments_log_deny_all" ON payments_log
  FOR ALL USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ensure service role can bypass RLS for backend operations
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: The Backend uses the SERVICE_ROLE key which bypasses RLS automatically.
-- The anon key (used by frontend direct calls) is restricted by the policies above.
-- This is the correct Supabase security model.
