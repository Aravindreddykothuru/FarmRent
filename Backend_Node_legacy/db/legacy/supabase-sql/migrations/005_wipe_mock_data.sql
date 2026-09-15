-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005: Wipe all seed / mock data
-- Run this ONCE in Supabase SQL Editor after going live.
-- This removes the 3 demo users, 8 demo equipment, 10 demo bookings seeded by seed.sql.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Wipe in dependency order (child tables first)
DELETE FROM reviews          WHERE reviewer_id IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM disputes         WHERE raised_by   IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM messages         WHERE sender_id   IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM notifications    WHERE user_id     IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM kyc_documents    WHERE user_id     IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM favorites        WHERE user_id     IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM payments_log     WHERE razorpay_order_id LIKE 'demo_%' OR razorpay_order_id LIKE 'seed_%';
DELETE FROM payments         WHERE razorpay_order_id LIKE 'demo_%' OR razorpay_order_id LIKE 'seed_%'
                                OR user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM locations        WHERE user_id     IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM bookings         WHERE renter_id   IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev')
                                OR owner_id    IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM equipment        WHERE owner_id    IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM refresh_tokens   WHERE user_id     IN (SELECT id FROM users WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev');
DELETE FROM users            WHERE email LIKE '%@demo.com' OR email LIKE '%@farmrent.dev';

-- Also wipe any equipment with placeholder/demo names that may have been inserted by other seed scripts
DELETE FROM bookings  WHERE equipment_id IN (
  SELECT id FROM equipment WHERE name ILIKE '%demo%' OR name ILIKE '%test%' OR name ILIKE '%sample%'
);
DELETE FROM equipment WHERE name ILIKE '%demo%' OR name ILIKE '%test%' OR name ILIKE '%sample%';

COMMIT;

-- Verification: these counts should all be 0
SELECT 'demo_users'     AS check_name, COUNT(*) AS remaining FROM users     WHERE email LIKE '%@demo.com';
SELECT 'demo_equipment' AS check_name, COUNT(*) AS remaining FROM equipment WHERE name ILIKE '%demo%';
SELECT 'demo_bookings'  AS check_name, COUNT(*) AS remaining FROM bookings  WHERE created_at < '2025-01-01';
