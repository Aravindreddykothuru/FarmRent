-- Migration 006: Add chats table, equipment_tracking table, pincode fields
-- Run in Supabase Dashboard → SQL Editor

-- ─── CHATS (OLX-style per-equipment conversations) ─────────────────────────
CREATE TABLE IF NOT EXISTS chats (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    farmer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (equipment_id, farmer_id)
);

-- ─── MESSAGES (upgrade: add chat_id, message_type columns) ─────────────────
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS chat_id      UUID REFERENCES chats(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image')),
    ADD COLUMN IF NOT EXISTS sender_name  TEXT;

-- ─── EQUIPMENT TRACKING (live GPS) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_tracking (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    timestamp    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_equipment_tracking_equipment ON equipment_tracking (equipment_id, timestamp DESC);

-- ─── ADD PINCODE/TOWN/VILLAGE COLUMNS TO EQUIPMENT & USERS ─────────────────
ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS pincode TEXT,
    ADD COLUMN IF NOT EXISTS town    TEXT,
    ADD COLUMN IF NOT EXISTS village TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pincode TEXT,
    ADD COLUMN IF NOT EXISTS town    TEXT,
    ADD COLUMN IF NOT EXISTS village TEXT;

-- ─── INDEXES ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_equipment_pincode   ON equipment (pincode);
CREATE INDEX IF NOT EXISTS idx_equipment_owner_id  ON equipment (owner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_farmer_id  ON bookings  (renter_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id    ON messages  (chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_farmer_id     ON chats     (farmer_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id      ON chats     (owner_id);
CREATE INDEX IF NOT EXISTS idx_chats_equipment_id  ON chats     (equipment_id);

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_tracking ENABLE ROW LEVEL SECURITY;

-- Users can only see chats they are a participant in
CREATE POLICY IF NOT EXISTS "chats_participants" ON chats
    FOR ALL USING (
        farmer_id = auth.uid() OR owner_id = auth.uid()
    );

-- Messages: users can see messages in their chats
CREATE POLICY IF NOT EXISTS "messages_participants" ON messages
    FOR ALL USING (
        sender_id = auth.uid()
        OR chat_id IN (
            SELECT id FROM chats WHERE farmer_id = auth.uid() OR owner_id = auth.uid()
        )
    );

-- Equipment tracking: owners can write, anyone can read
CREATE POLICY IF NOT EXISTS "tracking_owner_write" ON equipment_tracking
    FOR INSERT WITH CHECK (
        equipment_id IN (SELECT id FROM equipment WHERE owner_id = auth.uid())
    );

CREATE POLICY IF NOT EXISTS "tracking_read_all" ON equipment_tracking
    FOR SELECT USING (true);
