/**
 * runMigration.js — Runs all pending SQL migrations against Supabase
 * Usage:  node Backend/scripts/runMigration.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    console.error('❌  SUPABASE_URL / SUPABASE_SERVICE_KEY missing from .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

// Extract project ref from URL:  https://<ref>.supabase.co
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];

// ── Try Supabase Management API (runs raw SQL) ────────────────────────────────
async function runSqlViaManagementApi(sql) {
    const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                Authorization:   `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ query: sql }),
        }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
    return body;
}

// ── Fallback: try common column additions via supabase-js ─────────────────────
async function detectMissingColumns() {
    const { error } = await supabase
        .from('equipment')
        .select('address_full, village, town, district, state, pincode, service_radius_km, service_pincodes, avg_rating, rating_count')
        .limit(0);
    if (error && (error.message?.includes('schema cache') || error.message?.includes('Could not find'))) {
        return true; // columns missing
    }
    return false; // columns exist
}

// ── Read SQL file, strip comments, split by semicolon ─────────────────────────
function parseStatements(sql) {
    return sql
        .replace(/--[^\n]*/g, '')          // strip line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')  // strip block comments
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 10);       // skip empty / trivial lines
}

async function main() {
    console.log(`\n🌾 FarmRent Migration Runner`);
    console.log(`   Project: ${projectRef}\n`);

    // ── Step 1: check if migration is already applied ─────────────────────────
    const missing = await detectMissingColumns();
    if (!missing) {
        console.log('✅  equipment_location_schema columns already exist — nothing to do.\n');
        process.exit(0);
    }

    console.log('⚠️  Extended columns missing. Attempting migration via Supabase API…\n');

    // ── Step 2: try Management API with the service key ───────────────────────
    const sqlFile = path.join(__dirname, '..', 'supabase', 'equipment_location_schema.sql');
    if (!fs.existsSync(sqlFile)) {
        console.error('❌  equipment_location_schema.sql not found at', sqlFile);
        process.exit(1);
    }

    const rawSql = fs.readFileSync(sqlFile, 'utf8');
    const statements = parseStatements(rawSql);

    let successCount = 0;
    let failCount    = 0;
    const failed     = [];

    for (const stmt of statements) {
        const preview = stmt.slice(0, 70).replace(/\s+/g, ' ');
        try {
            await runSqlViaManagementApi(stmt);
            console.log(`  ✅  ${preview}…`);
            successCount++;
        } catch (e) {
            console.log(`  ⚠️   ${preview}… (${e.message})`);
            failCount++;
            failed.push({ stmt, error: e.message });
        }
    }

    console.log(`\n── Results ──────────────────────────────────────`);
    console.log(`   ✅  ${successCount} statements succeeded`);
    console.log(`   ⚠️   ${failCount} statements skipped / need manual run`);

    if (failed.length > 0) {
        const manualFile = path.join(__dirname, 'manual_migration.sql');
        fs.writeFileSync(manualFile, failed.map(f => f.stmt + ';').join('\n\n'));
        console.log(`\n📋  Statements that need manual execution saved to:`);
        console.log(`    ${manualFile}`);
        console.log(`\n   Paste them into: Supabase Dashboard → SQL Editor → New Query`);
        console.log(`   Dashboard URL: https://supabase.com/dashboard/project/${projectRef}/sql/new\n`);
    } else {
        console.log(`\n🎉  Migration complete! Restart the server to apply.\n`);
    }

    // ── Step 3: re-check columns ──────────────────────────────────────────────
    const stillMissing = await detectMissingColumns();
    if (!stillMissing) {
        console.log('✅  Verified: extended columns are now present in equipment table.\n');
    } else {
        console.log('ℹ️   Columns still missing — please run the SQL manually (link above).\n');
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
