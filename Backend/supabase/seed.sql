-- ============================================================
-- FarmRent — Seed Data (run AFTER schema.sql)
-- Passwords are bcrypt hash of "demo123"
-- ============================================================

-- Demo Users
INSERT INTO users (id, email, name, role, password_hash) VALUES
  ('11111111-0000-0000-0000-000000000001', 'farmer@demo.com', 'Demo Farmer', 'farmer', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('11111111-0000-0000-0000-000000000002', 'owner@demo.com',  'Demo Owner',  'owner',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'),
  ('11111111-0000-0000-0000-000000000003', 'admin@demo.com',  'Demo Admin',  'admin',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')
ON CONFLICT (email) DO NOTHING;

-- Demo Equipment
INSERT INTO equipment (id, owner_id, name, type, description, price_per_day, location, latitude, longitude, status, horsepower, year, brand) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'John Deere 5075E Tractor',     'Tractor',   '75HP utility tractor, ideal for plowing and seeding',        2500, 'Hyderabad, Telangana',  17.3850, 78.4867, 'available', 75 , 2021, 'John Deere'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Mahindra 575 DI Tractor',      'Tractor',   '47HP tractor suitable for small to medium farms',           2000, 'Warangal, Telangana',   17.9784, 79.5941, 'available', 47 , 2020, 'Mahindra'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000002', 'CLAAS Lexion Harvester',       'Harvester', 'High-capacity combine harvester for wheat and rice',        4500, 'Nizamabad, Telangana',  18.6700, 78.0942, 'available', 365, 2022, 'CLAAS'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000002', 'Fieldking Disc Harrow',        'Harrow',    'Heavy-duty disc harrow for soil preparation',               1200, 'Karimnagar, Telangana', 18.4386, 79.1288, 'available', NULL, 2019, 'Fieldking'),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', 'Boom Sprayer 600L',            'Sprayer',   '12-metre boom sprayer for pesticide/fertiliser application', 800, 'Nalgonda, Telangana',   17.0575, 79.2674, 'available', NULL, 2020, 'Aspee'),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000002', 'Rotavator 7 Feet',             'Rotavator', 'Tractor-mounted rotavator for seedbed preparation',           600, 'Medak, Telangana',      18.0453, 78.2639, 'available', NULL, 2021, 'Shaktiman'),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000002', 'New Holland TC5.30 Harvester', 'Harvester', 'Versatile combine harvester for multiple crops',            5000, 'Khammam, Telangana',    17.2473, 80.1514, 'available', 175, 2023, 'New Holland'),
  ('22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000002', 'Sonalika 60 RX Maize',        'Tractor',   '60HP tractor specialised for maize cultivation',            2200, 'Adilabad, Telangana',   19.6641, 78.5320, 'available', 60 , 2022, 'Sonalika')
ON CONFLICT (id) DO NOTHING;

-- Demo Bookings
INSERT INTO bookings (id, equipment_id, renter_id, owner_id, farmer_name, start_date, end_date, total_amount, status, payment_method) VALUES
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Ravi',    '2026-03-15', '2026-03-17',  7500, 'pending',   'razorpay'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Sita',    '2026-03-21', '2026-03-23',  7500, 'confirmed', 'stripe'),
  ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Naresh',  '2026-03-12', '2026-03-14',  8400, 'pending',   'razorpay'),
  ('33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Anil',    '2026-03-18', '2026-03-20',  9000, 'confirmed', 'razorpay'),
  ('33333333-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Lakshmi', '2026-03-25', '2026-03-28', 14000, 'pending',   'stripe'),
  ('33333333-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Ramesh',  '2026-03-19', '2026-03-19',  8000, 'confirmed', 'razorpay'),
  ('33333333-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Geetha',  '2026-03-22', '2026-03-23', 16000, 'pending',   'razorpay'),
  ('33333333-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Vijay',   '2026-03-13', '2026-03-13',  1500, 'confirmed', 'stripe'),
  ('33333333-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Pooja',   '2026-03-16', '2026-03-16',  1200, 'pending',   'razorpay'),
  ('33333333-0000-0000-0000-000000000010', '22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'Arjun',   '2026-03-27', '2026-03-29', 12000, 'pending',   'razorpay')
ON CONFLICT (id) DO NOTHING;
