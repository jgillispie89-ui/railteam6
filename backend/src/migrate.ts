import { pool } from './db.js';

// =============================================================================
// DB migration — idempotent. Previously ran on server boot; now run out-of-band:
//   npm run migrate
//
// IMPORTANT: run this against the Supabase *direct* connection (port 5432), not
// the transaction pooler (6543). `ALTER TYPE ... ADD VALUE` and DO $$...$$ blocks
// do not behave correctly under transaction-mode pooling.
// =============================================================================
export async function migrate() {
    // Fresh installs: create users table with UUID primary key
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email                           VARCHAR(255) UNIQUE NOT NULL,
            password_hash                   TEXT,
            role                            VARCHAR(20) NOT NULL DEFAULT 'contributor',
            verified                        BOOLEAN NOT NULL DEFAULT false,
            verification_token              TEXT,
            verification_token_expires_at   TIMESTAMPTZ,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Existing installs: add any missing columns without touching existing data
    await pool.query(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash                  TEXT,
            ADD COLUMN IF NOT EXISTS role                           VARCHAR(20) NOT NULL DEFAULT 'contributor',
            ADD COLUMN IF NOT EXISTS verified                       BOOLEAN     NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS verification_token             TEXT,
            ADD COLUMN IF NOT EXISTS verification_token_expires_at  TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await pool.query(`
        ALTER TABLE sites
            ADD COLUMN IF NOT EXISTS mod_status   VARCHAR(20) NOT NULL DEFAULT 'approved',
            ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
            ADD COLUMN IF NOT EXISTS mod_note     TEXT,
            ADD COLUMN IF NOT EXISTS photo_url    TEXT,
            ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ
    `);

    await pool.query(`ALTER TABLE historic_maps ADD COLUMN IF NOT EXISTS bounds JSONB`);

    await pool.query(`ALTER TYPE site_status ADD VALUE IF NOT EXISTS 'daylighted_active'`);
    await pool.query(`ALTER TYPE site_status ADD VALUE IF NOT EXISTS 'daylighted_inactive'`);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_send_failed BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_send_error TEXT`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS site_photos (
            id         SERIAL PRIMARY KEY,
            site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
            url        TEXT NOT NULL,
            thumb_url  TEXT,
            sort_order INT  NOT NULL DEFAULT 0
        )
    `);

    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE feedback_type AS ENUM ('suggestion', 'bug_report', 'site_correction', 'other');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);
    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE feedback_status AS ENUM ('new', 'in_progress', 'resolved', 'dismissed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);
    // Backfill: add in_progress if this enum was created before the rename
    await pool.query(`ALTER TYPE feedback_status ADD VALUE IF NOT EXISTS 'in_progress'`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type              feedback_type NOT NULL,
            subject           TEXT NOT NULL,
            description       TEXT NOT NULL,
            submitter_name    TEXT,
            submitter_email   TEXT,
            submitter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            status            feedback_status NOT NULL DEFAULT 'new',
            admin_notes       TEXT,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

// Run directly with `npm run migrate` (tsx src/migrate.ts)
if (import.meta.url === `file://${process.argv[1]}`) {
    migrate()
        .then(() => { console.log('[migrate] complete'); process.exit(0); })
        .catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
}
