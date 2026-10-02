#!/usr/bin/env node
/**
 * Applies db/migrations/NNNN_name.sql files in order over a direct Postgres connection.
 *
 *   DATABASE_URL=postgres://... node db/migrate.js
 *
 * - Each file runs in its own transaction and is recorded in schema_migrations with a checksum.
 * - Re-running is a no-op; editing an already-applied file is rejected (add a new migration instead).
 * - A session advisory lock prevents two runners (e.g. two app replicas) from migrating concurrently.
 * - Signals PostgREST to reload its schema cache so new columns are visible to supabase-js immediately.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

require('dotenv').config({ path: process.env.FARMRENT_ENV_FILE || path.join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 'farmrent_schema_migrations';

async function migrate(connectionString, log = console.log) {
    const client = new Client({ connectionString });
    await client.connect();
    try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    TEXT PRIMARY KEY,
                checksum   TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);

        const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
        const applied = new Map(rows.map((r) => [r.version, r.checksum]));
        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
            .sort();

        let appliedNow = 0;
        for (const file of files) {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            const checksum = crypto.createHash('sha256').update(sql).digest('hex');

            if (applied.has(file)) {
                if (applied.get(file) !== checksum) {
                    throw new Error(
                        `${file} changed after it was applied (checksum mismatch). Create a new migration instead of editing an applied one.`,
                    );
                }
                log(`  up-to-date  ${file}`);
                continue;
            }

            await client.query('BEGIN');
            try {
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                err.message = `${file} failed: ${err.message}`;
                throw err;
            }
            log(`  applied     ${file}`);
            appliedNow++;
        }

        await client.query("NOTIFY pgrst, 'reload schema'");
        log(`Migrations complete — ${appliedNow} applied, ${files.length - appliedNow} already up to date.`);
        return { applied: appliedNow, total: files.length };
    } finally {
        // Closing the session releases the advisory lock.
        await client.end();
    }
}

if (require.main === module) {
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set. Point it at the Postgres database to migrate.');
        process.exit(1);
    }
    migrate(url).catch((err) => {
        console.error(`Migration failed: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { migrate };
