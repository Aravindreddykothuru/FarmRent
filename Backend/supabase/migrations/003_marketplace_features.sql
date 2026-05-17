-- Migration: Marketplace features — Favorites & Offers/Negotiation
-- Run in Supabase Dashboard → SQL Editor → New Query

-- ── Favorites ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS favorites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    equipment_id TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user    ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_equip   ON favorites(equipment_id);

-- ── Price Offers / Negotiation ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id            TEXT NOT NULL,
    renter_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_price_per_day   NUMERIC(10,2) NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,
    total_days              INT GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
    message                 TEXT,
    status                  VARCHAR(20) DEFAULT 'pending'
                                CHECK (status IN ('pending','accepted','rejected','countered','expired')),
    counter_price           NUMERIC(10,2),
    counter_message         TEXT,
    booking_id              UUID REFERENCES bookings(id) ON DELETE SET NULL,
    expires_at              TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_offers_renter    ON offers(renter_id);
CREATE INDEX IF NOT EXISTS idx_offers_owner     ON offers(owner_id);
CREATE INDEX IF NOT EXISTS idx_offers_equipment ON offers(equipment_id);
CREATE INDEX IF NOT EXISTS idx_offers_status    ON offers(status);

-- ── Saved Searches ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(200) NOT NULL,
    filters    JSONB NOT NULL DEFAULT '{}',
    alert_on   BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
