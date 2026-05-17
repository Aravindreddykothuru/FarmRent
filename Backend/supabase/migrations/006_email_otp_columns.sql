-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: Add email verification + password reset + OTP columns to users
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verify_token   TEXT,
  ADD COLUMN IF NOT EXISTS email_verify_expiry  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expiry TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_verified       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone_otp_hash       TEXT,
  ADD COLUMN IF NOT EXISTS phone_otp_expiry     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_attempts         SMALLINT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip        TEXT;

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verify_token   ON users (email_verify_token)   WHERE email_verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users (password_reset_token) WHERE password_reset_token IS NOT NULL;
