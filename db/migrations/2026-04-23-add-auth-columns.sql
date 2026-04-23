-- 2026-04-23: Add auth and moderation columns
-- Idempotent — safe to run multiple times (IF NOT EXISTS guards everything)
--
-- Applied automatically on startup via server.ts migrate().
-- Run manually against any environment with:
--   psql $DATABASE_URL -f db/migrations/2026-04-23-add-auth-columns.sql

-- Auth columns for existing users table (production has UUID primary key)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash                  TEXT,
    ADD COLUMN IF NOT EXISTS role                           VARCHAR(20) NOT NULL DEFAULT 'contributor',
    ADD COLUMN IF NOT EXISTS verified                       BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verification_token             TEXT,
    ADD COLUMN IF NOT EXISTS verification_token_expires_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Moderation columns on sites table
ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS mod_status   VARCHAR(20) NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS mod_note     TEXT;
