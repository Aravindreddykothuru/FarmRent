#!/usr/bin/env node
/**
 * Demo data for local development and manual testing:
 * one admin, two owners, two farmers, equipment in three districts and a few promo codes.
 *
 *   DATABASE_URL=postgres://... node db/seed.js
 *
 * Idempotent (upserts by email / fixed ids). Refuses to run when NODE_ENV=production.
 * All demo accounts share SEED_PASSWORD (default below) and are printed at the end.
 */
'use strict';

const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

require('dotenv').config({ path: process.env.FARMRENT_ENV_FILE || path.join(__dirname, '..', '.env') });

const PASSWORD = process.env.SEED_PASSWORD || 'FarmRent@2026';

const USERS = [
    { email: 'admin@farmrent.local', name: 'Asha Admin', phone: '9000000001', role: 4 },
    { email: 'owner1@farmrent.local', name: 'Ravi Kumar', phone: '9000000002', role: 3, district: 'Anantapur', state: 'Andhra Pradesh' },
    { email: 'owner2@farmrent.local', name: 'Lakshmi Devi', phone: '9000000003', role: 3, district: 'Guntur', state: 'Andhra Pradesh' },
    { email: 'farmer1@farmrent.local', name: 'Suresh Reddy', phone: '9000000004', role: 1, district: 'Anantapur', state: 'Andhra Pradesh' },
    { email: 'farmer2@farmrent.local', name: 'Meena Patil', phone: '9000000005', role: 1, district: 'Nashik', state: 'Maharashtra' },
];

// id, owner email, name, category, brand, daily rate, district, state, pincode, lat, lng
const EQUIPMENT = [
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000001',
        'owner1@farmrent.local',
        'Mahindra 575 DI Tractor',
        'tractor',
        'Mahindra',
        1800,
        'Anantapur',
        'Andhra Pradesh',
        '515001',
        14.6819,
        77.6006,
    ],
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000002',
        'owner1@farmrent.local',
        'Kubota DC-68G Combine',
        'combine-harvester',
        'Kubota',
        6500,
        'Anantapur',
        'Andhra Pradesh',
        '515002',
        14.69,
        77.61,
    ],
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000003',
        'owner1@farmrent.local',
        'Shaktiman Rotavator 7ft',
        'rotavator',
        'Shaktiman',
        900,
        'Anantapur',
        'Andhra Pradesh',
        '515004',
        14.67,
        77.59,
    ],
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000004',
        'owner2@farmrent.local',
        'Swaraj 744 FE Tractor',
        'tractor',
        'Swaraj',
        1600,
        'Guntur',
        'Andhra Pradesh',
        '522001',
        16.3067,
        80.4365,
    ],
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000005',
        'owner2@farmrent.local',
        'Aspee Boom Sprayer 400L',
        'boom-sprayer',
        'Aspee',
        700,
        'Guntur',
        'Andhra Pradesh',
        '522002',
        16.31,
        80.44,
    ],
    [
        '5b6d8c1e-0001-4a3b-9c2d-000000000006',
        'owner2@farmrent.local',
        'Dasmesh Multi-crop Thresher',
        'thresher',
        'Dasmesh',
        1200,
        'Nashik',
        'Maharashtra',
        '422001',
        19.9975,
        73.7898,
    ],
];

const PROMO_CODES = [
    // code, label, type, value, min order, max discount, usage limit
    ['FARM100', '₹100 off on your booking', 'flat', 100, 500, null, null],
    ['KISAN200', 'Kisan special — ₹200 off', 'flat', 200, 2000, null, null],
    ['HARVEST10', '10% off your rental (up to ₹1000)', 'percent', 10, 0, 1000, 500],
];

async function seed(connectionString) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to seed demo data with NODE_ENV=production');
    }
    const client = new Client({ connectionString });
    await client.connect();
    try {
        await client.query('BEGIN');
        const passwordHash = await bcrypt.hash(PASSWORD, 12);

        const userIds = {};
        for (const u of USERS) {
            const { rows } = await client.query(
                `INSERT INTO users (email, full_name, phone, password_hash, email_verified, district, state)
                 VALUES ($1, $2, $3, $4, TRUE, $5, $6)
                 ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash
                 RETURNING id`,
                [u.email, u.name, u.phone, passwordHash, u.district || null, u.state || null],
            );
            userIds[u.email] = rows[0].id;
            await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [rows[0].id, u.role]);
        }

        for (const [id, ownerEmail, name, category, brand, rate, district, state, pincode, lat, lng] of EQUIPMENT) {
            await client.query(
                `INSERT INTO equipment (id, owner_id, name, category, brand, description, daily_rate, district, state, pincode,
                                        address_full, latitude, longitude, pickup_lat, pickup_lng, pickup_address,
                                        images, features, status, is_verified)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $13, $11, '{}', $14, 'active', TRUE)
                 ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, daily_rate = EXCLUDED.daily_rate,
                     is_deleted = FALSE, status = 'active', is_verified = TRUE`,
                [
                    id,
                    userIds[ownerEmail],
                    name,
                    category,
                    brand,
                    `${name} available for rent in ${district}. Well maintained and serviced.`,
                    rate,
                    district,
                    state,
                    pincode,
                    `${district}, ${state} ${pincode}`,
                    lat,
                    lng,
                    ['Fuel efficient', 'Serviced this season'],
                ],
            );
        }

        for (const [code, label, type, value, minOrder, maxDiscount, usageLimit] of PROMO_CODES) {
            await client.query(
                `INSERT INTO promo_codes (code, label, discount_type, discount_value, min_order_value, max_discount, usage_limit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, is_active = TRUE`,
                [code, label, type, value, minOrder, maxDiscount, usageLimit],
            );
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        await client.end();
    }

    console.log(`Seeded ${USERS.length} users, ${EQUIPMENT.length} equipment listings, ${PROMO_CODES.length} promo codes.`);
    console.log(`Demo password for every account: ${PASSWORD}`);
    USERS.forEach((u) => console.log(`  ${u.email}`));
}

if (require.main === module) {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }
    seed(process.env.DATABASE_URL).catch((err) => {
        console.error(`Seeding failed: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { seed, USERS, EQUIPMENT };
