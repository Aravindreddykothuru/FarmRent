/**
 * GPS Tracking Phase-1 Migration Runner
 * Run from the Backend/ directory:  node run_gps_migration.js
 *
 * Connects to Supabase via their Supavisor connection pooler, which accepts
 * the service_role JWT as the database password (Supabase feature, 2024+).
 * Tries multiple AWS regions until one connects.
 */

'use strict';

require('dotenv').config();
const { Client } = require('pg');

const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';

// Extract project ref from URL:  https://[ref].supabase.co
const PROJECT_REF  = SUPABASE_URL.replace('https://', '').split('.')[0];

if (!SERVICE_KEY || !PROJECT_REF) {
  console.error('❌  SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

// Supabase Supavisor pooler regions to try (port 6543 = transaction mode)
const POOLER_HOSTS = [
  `aws-0-ap-south-1.pooler.supabase.com`,    // India / AP South
  `aws-0-us-east-1.pooler.supabase.com`,    // US East
  `aws-0-us-west-1.pooler.supabase.com`,    // US West
  `aws-0-eu-central-1.pooler.supabase.com`, // EU Central
  `aws-0-ap-southeast-1.pooler.supabase.com`, // SEA
];

// The full SQL migration
const SQL_STEPS = [
  {
    name: 'Add pickup columns to equipment',
    sql: `
      ALTER TABLE equipment
        ADD COLUMN IF NOT EXISTS pickup_lat      DECIMAL(10,8),
        ADD COLUMN IF NOT EXISTS pickup_lng      DECIMAL(11,8),
        ADD COLUMN IF NOT EXISTS pickup_address  TEXT,
        ADD COLUMN IF NOT EXISTS pickup_landmark TEXT;
    `,
  },
  {
    name: 'Create equipment_locations table',
    sql: `
      CREATE TABLE IF NOT EXISTS equipment_locations (
        id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
        equipment_id  UUID        REFERENCES equipment(id) ON DELETE CASCADE,
        booking_id    UUID        REFERENCES bookings(id)  ON DELETE CASCADE,
        lat           DECIMAL(10,8) NOT NULL,
        lng           DECIMAL(11,8) NOT NULL,
        accuracy      DECIMAL(10,2),
        speed         DECIMAL(10,2),
        heading       DECIMAL(10,2),
        altitude      DECIMAL(10,2),
        source        VARCHAR(20) DEFAULT 'mobile_gps',
        device_id     TEXT,
        battery_level INT,
        updated_at    TIMESTAMPTZ DEFAULT NOW(),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: 'Create index on equipment_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_equipment_locations_equipment_id ON equipment_locations(equipment_id);`,
  },
  {
    name: 'Create index on booking_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_equipment_locations_booking_id ON equipment_locations(booking_id);`,
  },
  {
    name: 'Create index on updated_at',
    sql: `CREATE INDEX IF NOT EXISTS idx_equipment_locations_updated_at ON equipment_locations(updated_at DESC);`,
  },
  {
    name: 'Create cleanup function',
    sql: `
      CREATE OR REPLACE FUNCTION cleanup_old_locations()
      RETURNS TRIGGER AS $$
      BEGIN
        DELETE FROM equipment_locations
        WHERE equipment_id = NEW.equipment_id
          AND id NOT IN (
            SELECT id FROM equipment_locations
            WHERE equipment_id = NEW.equipment_id
            ORDER BY updated_at DESC
            LIMIT 500
          );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `,
  },
  {
    name: 'Create cleanup trigger',
    sql: `
      DROP TRIGGER IF EXISTS trigger_cleanup_locations ON equipment_locations;
      CREATE TRIGGER trigger_cleanup_locations
        AFTER INSERT ON equipment_locations
        FOR EACH ROW EXECUTE FUNCTION cleanup_old_locations();
    `,
  },
  {
    name: 'Enable RLS on equipment_locations',
    sql: `ALTER TABLE equipment_locations ENABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'RLS policy: farmer can view location',
    sql: `
      DROP POLICY IF EXISTS "Farmer can view equipment location" ON equipment_locations;
      CREATE POLICY "Farmer can view equipment location" ON equipment_locations
        FOR SELECT USING (
          auth.uid() IN (SELECT farmer_id FROM bookings WHERE id = booking_id)
        );
    `,
  },
  {
    name: 'RLS policy: owner can insert location',
    sql: `
      DROP POLICY IF EXISTS "Owner can insert location" ON equipment_locations;
      CREATE POLICY "Owner can insert location" ON equipment_locations
        FOR INSERT WITH CHECK (
          auth.uid() IN (SELECT owner_id FROM bookings WHERE id = booking_id)
        );
    `,
  },
  {
    name: 'RLS policy: owner can view own locations',
    sql: `
      DROP POLICY IF EXISTS "Owner can view own locations" ON equipment_locations;
      CREATE POLICY "Owner can view own locations" ON equipment_locations
        FOR SELECT USING (
          auth.uid() IN (SELECT owner_id FROM bookings WHERE id = booking_id)
        );
    `,
  },
  {
    name: 'Create get_latest_location RPC function',
    sql: `
      CREATE OR REPLACE FUNCTION get_latest_location(p_booking_id UUID)
      RETURNS TABLE(
        lat        DECIMAL,
        lng        DECIMAL,
        accuracy   DECIMAL,
        speed      DECIMAL,
        heading    DECIMAL,
        updated_at TIMESTAMPTZ
      ) AS $$
        SELECT lat, lng, accuracy, speed, heading, updated_at
        FROM equipment_locations
        WHERE booking_id = p_booking_id
        ORDER BY updated_at DESC
        LIMIT 1;
      $$ LANGUAGE sql SECURITY DEFINER;
    `,
  },
];

async function tryConnect(host) {
  const client = new Client({
    host,
    port: 6543,
    database: 'postgres',
    user: `postgres.${PROJECT_REF}`,
    password: SERVICE_KEY,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  return client;
}

async function runMigration() {
  console.log(`\n🚀  FarmDirect GPS Tracking — Phase 1 Migration`);
  console.log(`    Project: ${PROJECT_REF}`);
  console.log(`─────────────────────────────────────────────\n`);

  let client = null;

  // Try each pooler region until one connects
  for (const host of POOLER_HOSTS) {
    process.stdout.write(`🔌  Trying ${host} ... `);
    try {
      client = await tryConnect(host);
      console.log('✅  Connected!');
      break;
    } catch (err) {
      console.log(`❌  ${err.message}`);
    }
  }

  if (!client) {
    console.error('\n❌  Could not connect to any Supabase pooler endpoint.');
    console.error('    Please run Backend/supabase/gps_tracking_phase1.sql');
    console.error('    manually in the Supabase SQL Editor:');
    console.error('    https://supabase.com/dashboard/project/' + PROJECT_REF + '/sql/new');
    process.exit(1);
  }

  console.log('\n📋  Running SQL steps...\n');

  let passed = 0;
  let failed = 0;

  for (const step of SQL_STEPS) {
    process.stdout.write(`  ⟶  ${step.name} ... `);
    try {
      await client.query(step.sql);
      console.log('✅');
      passed++;
    } catch (err) {
      // "already exists" errors are safe to ignore
      if (
        err.message.includes('already exists') ||
        err.message.includes('duplicate') ||
        err.code === '42710' ||   // duplicate_object
        err.code === '42P07'      // duplicate_table
      ) {
        console.log('⚠️  already exists (skipped)');
        passed++;
      } else {
        console.log(`❌  ${err.message}`);
        failed++;
      }
    }
  }

  await client.end();

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`✅  ${passed} steps passed   ❌  ${failed} steps failed`);

  if (failed === 0) {
    console.log(`\n🎉  Migration complete!`);
    console.log(`\n📡  NEXT STEP — Enable Realtime on equipment_locations:`);
    console.log(`    Supabase Dashboard → Database → Replication`);
    console.log(`    → Add table: equipment_locations`);
    console.log(`    URL: https://supabase.com/dashboard/project/${PROJECT_REF}/database/replication`);
  } else {
    console.log(`\n⚠️  Some steps failed. Run gps_tracking_phase1.sql manually.`);
  }
  console.log('');
}

runMigration().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
