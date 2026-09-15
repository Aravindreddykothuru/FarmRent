-- Migration: 010_indexing_and_optimizations.sql
-- Optimizes query performance on large tables by establishing indexes on foreign keys, status columns, and timestamp fields.

-- 1. Equipment Table Indexes
CREATE INDEX IF NOT EXISTS idx_equipment_owner_id ON equipment(owner_id);
CREATE INDEX IF NOT EXISTS idx_equipment_is_verified ON equipment(is_verified) WHERE is_verified = true;
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_created_at ON equipment(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON equipment(category);

-- 2. Bookings (equipment_rentals) Table Indexes
CREATE INDEX IF NOT EXISTS idx_rentals_renter_id ON equipment_rentals(renter_id);
CREATE INDEX IF NOT EXISTS idx_rentals_owner_id ON equipment_rentals(owner_id);
CREATE INDEX IF NOT EXISTS idx_rentals_equipment_id ON equipment_rentals(equipment_id);
CREATE INDEX IF NOT EXISTS idx_rentals_driver_id ON equipment_rentals(driver_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON equipment_rentals(status);
CREATE INDEX IF NOT EXISTS idx_rentals_dates ON equipment_rentals(start_date, end_date);

-- 3. Payments Table Indexes
CREATE INDEX IF NOT EXISTS idx_payments_reference_id ON payments(reference_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- 4. Messages Table Indexes
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
