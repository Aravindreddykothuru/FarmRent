-- An audit trail of phone OTP requests.
--
-- The counters that actually refuse a request live in Redis, where a sliding window costs one round trip
-- and expires itself. This table answers the questions Redis cannot, because its keys are gone within the
-- hour: which numbers were targeted last week, from which addresses, and how often a code was sent but
-- never confirmed. That is what an abuse complaint or a surprise SMS bill needs.
--
-- No OTP is recorded. With 2Factor's AUTOGEN flow the API never learns the code, and nothing here would
-- be allowed to store it if it did.

CREATE TABLE IF NOT EXISTS otp_requests (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone      TEXT NOT NULL,
    ip         TEXT,
    purpose    TEXT NOT NULL CHECK (purpose IN ('login', 'signup')),
    attempts   SMALLINT NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'sent'
               CHECK (status IN ('sent', 'verified', 'failed', 'send_failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reads are always "recent rows for this number" or "recent rows for this address".
CREATE INDEX IF NOT EXISTS otp_requests_phone_created_idx ON otp_requests (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_requests_ip_created_idx    ON otp_requests (ip, created_at DESC);

-- Same two layers as every other application table (see 0005): the public API roles hold no privileges,
-- and row-level security is on with no policies, so a granted privilege alone still exposes nothing.
-- The integration suite asserts this for every table in the schema.
ALTER TABLE otp_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON otp_requests FROM anon, authenticated;
