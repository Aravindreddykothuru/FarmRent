'use strict';
/**
 * Seed script — populates MongoDB with demo users and 20 machines
 * Usage: node scripts/seed.js
 * Safe to run repeatedly (upserts by email / machine name+owner)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Machine = require('../models/Machine');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/farmrent';

const USERS = [
    { name: 'Ravi Kumar (Admin)', email: 'admin@farmrent.in', password: 'Admin@123', role: 'admin', phone: '9800000001', village: '', district: 'Hyderabad', state: 'Telangana' },
    { name: 'Suresh Reddy', email: 'owner@farmrent.in', password: 'Owner@123', role: 'owner', phone: '9800000002', village: 'Nalgonda', district: 'Nalgonda', state: 'Telangana' },
    { name: 'Ramesh Naidu', email: 'farmer@farmrent.in', password: 'Farmer@123', role: 'farmer', phone: '9800000003', village: 'Warangal', district: 'Warangal', state: 'Telangana' },
];

const CATEGORIES = [
    'Land Preparation', 'Soil Cultivation', 'Planting Equipment',
    'Crop Care', 'Harvesting Equipment', 'Transport & Support',
];

const makeMachines = (ownerId) => [
    // ── Land Preparation ─────────────────────────────────────────────────────
    {
        name: 'Moldboard Plough', type: 'moldboard-plough', category: CATEGORIES[0],
        description: 'Heavy-duty moldboard plough for deep soil turning. Ideal for hard clay soils.',
        pricing: { baseRatePerDay: 2500, baseRatePerHour: 350, securityDeposit: 3000, operatorIncluded: true },
        location: { village: 'Nalgonda', district: 'Nalgonda', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.2643, 17.0588] } },
        images: ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'],
        specifications: { weight: '350 kg', width: '1.2 m', depth: '30 cm' },
        features: ['Deep tillage', 'Rugged frame', 'Adjustable depth'],
    },
    {
        name: 'Disc Harrow (Heavy Duty)', type: 'disc-harrow', category: CATEGORIES[0],
        description: 'Heavy disc harrow for breaking up soil clods after ploughing.',
        pricing: { baseRatePerDay: 2000, baseRatePerHour: 280, securityDeposit: 2500, operatorIncluded: false },
        location: { village: 'Nalgonda', district: 'Nalgonda', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.2700, 17.0600] } },
        images: ['https://images.unsplash.com/photo-1589923188900-85dae523342b?w=600'],
        specifications: { discs: '16', diameter: '660 mm' },
        features: ['Self-aligning bearings', 'Adjustable gang angle'],
    },
    {
        name: 'Land Leveler', type: 'land-leveler', category: CATEGORIES[0],
        description: 'Laser-guided land leveler for precise field preparation.',
        pricing: { baseRatePerDay: 3500, baseRatePerHour: 500, securityDeposit: 5000, operatorIncluded: true },
        location: { village: 'Medak', district: 'Medak', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.2630, 17.9150] } },
        images: ['https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=600'],
        specifications: { blade_width: '3.6 m', capacity: '3.5 m³' },
        features: ['Laser guided', 'High productivity'],
    },
    // ── Soil Cultivation ─────────────────────────────────────────────────────
    {
        name: 'Rotavator (6 ft)', type: 'rotavator', category: CATEGORIES[1],
        description: 'Powerful rotavator for fine seedbed preparation and weed control.',
        pricing: { baseRatePerDay: 1800, baseRatePerHour: 250, securityDeposit: 2000, operatorIncluded: false },
        location: { village: 'Nizamabad', district: 'Nizamabad', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.0931, 18.6725] } },
        images: ['https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=600'],
        specifications: { blades: '48', working_width: '1.8 m', working_depth: '15 cm' },
        features: ['Gear-driven', 'Side deflectors included'],
    },
    {
        name: 'Power Tiller (8.5 HP)', type: 'power-tiller', category: CATEGORIES[1],
        description: '8.5 HP power tiller suitable for paddy and vegetable cultivation.',
        pricing: { baseRatePerDay: 1200, baseRatePerHour: 180, securityDeposit: 1500, operatorIncluded: false },
        location: { village: 'Karimnagar', district: 'Karimnagar', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.1288, 18.4386] } },
        images: ['https://images.unsplash.com/photo-1566927366571-cff023c06f6b?w=600'],
        specifications: { engine: '8.5 HP Diesel', weight: '420 kg' },
        features: ['Reverse gear', 'Float attachment available'],
    },
    // ── Planting Equipment ────────────────────────────────────────────────────
    {
        name: 'Seed Drill (11-Row)', type: 'seed-drill', category: CATEGORIES[2],
        description: '11-row seed drill for uniform sowing of wheat, sorghum, and pulses.',
        pricing: { baseRatePerDay: 2200, baseRatePerHour: 300, securityDeposit: 3000, operatorIncluded: false },
        location: { village: 'Adilabad', district: 'Adilabad', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.5318, 19.6640] } },
        images: ['https://images.unsplash.com/photo-1560493676-04071c5f467b?w=600'],
        specifications: { rows: 11, row_spacing: '22.5 cm', seed_box: '70 L' },
        features: ['Fertiliser box included', 'Zero-till capability'],
    },
    {
        name: 'Rice Transplanter (8-Row)', type: 'rice-transplanter', category: CATEGORIES[2],
        description: 'Self-propelled 8-row rice transplanter for high-speed paddy planting.',
        pricing: { baseRatePerDay: 4000, baseRatePerHour: 600, securityDeposit: 6000, operatorIncluded: true },
        location: { village: 'Khammam', district: 'Khammam', state: 'Telangana', coordinates: { type: 'Point', coordinates: [80.1514, 17.2473] } },
        images: ['https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600'],
        specifications: { rows: 8, row_spacing: '30 cm', speed: '0.8 m/s' },
        features: ['Float-type seedling unit', 'GPS guidance ready'],
    },
    // ── Crop Care ────────────────────────────────────────────────────────────
    {
        name: 'Boom Sprayer (15 m)', type: 'boom-sprayer', category: CATEGORIES[3],
        description: '15-metre boom sprayer for large-scale pesticide and herbicide application.',
        pricing: { baseRatePerDay: 2800, baseRatePerHour: 400, securityDeposit: 4000, operatorIncluded: true },
        location: { village: 'Mahabubnagar', district: 'Mahabubnagar', state: 'Telangana', coordinates: { type: 'Point', coordinates: [77.9878, 16.7488] } },
        images: ['https://images.unsplash.com/photo-1592087046781-3c9d22a44d22?w=600'],
        specifications: { tank: '600 L', boom_width: '15 m', nozzles: 30 },
        features: ['Auto boom fold', 'GPS mapping', 'Anti-drip nozzles'],
    },
    {
        name: 'Fertilizer Spreader', type: 'fertilizer-spreader', category: CATEGORIES[3],
        description: 'Centrifugal fertilizer spreader with 1000 L capacity.',
        pricing: { baseRatePerDay: 1600, baseRatePerHour: 220, securityDeposit: 2000, operatorIncluded: false },
        location: { village: 'Siddipet', district: 'Siddipet', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.8521, 18.1030] } },
        images: ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'],
        specifications: { capacity: '1000 L', spread_width: '24 m' },
        features: ['Variable rate option', 'Stainless hopper'],
    },
    // ── Harvesting Equipment ──────────────────────────────────────────────────
    {
        name: 'Combine Harvester', type: 'combine-harvester', category: CATEGORIES[4],
        description: 'John Deere 5065E combine harvester for wheat, paddy, and maize.',
        pricing: { baseRatePerDay: 12000, baseRatePerHour: 1800, securityDeposit: 20000, operatorIncluded: true },
        location: { village: 'Zaheerabad', district: 'Sangareddy', state: 'Telangana', coordinates: { type: 'Point', coordinates: [77.6005, 17.6813] } },
        images: ['https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600'],
        specifications: { brand: 'John Deere', model: '5065E', header_width: '4.9 m', engine: '108 HP' },
        features: ['AC cab', 'Real-time yield monitor', 'GPS tracking'],
    },
    {
        name: 'Paddy Thresher', type: 'thresher', category: CATEGORIES[4],
        description: '5-hp portable paddy thresher, suitable for small and medium farms.',
        pricing: { baseRatePerDay: 1400, baseRatePerHour: 200, securityDeposit: 1500, operatorIncluded: false },
        location: { village: 'Ramagundam', district: 'Peddapalli', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.4730, 18.7523] } },
        images: ['https://images.unsplash.com/photo-1589923188900-85dae523342b?w=600'],
        specifications: { engine: '5 HP', capacity: '500 kg/hr' },
        features: ['Portable design', 'Low grain loss'],
    },
    {
        name: 'Reaper Binder', type: 'reaper', category: CATEGORIES[4],
        description: 'Self-propelled reaper binder for paddy and wheat harvesting.',
        pricing: { baseRatePerDay: 3200, baseRatePerHour: 460, securityDeposit: 4000, operatorIncluded: true },
        location: { village: 'Mancherial', district: 'Mancherial', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.4346, 18.8736] } },
        images: ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'],
        specifications: { cutting_width: '1.2 m', speed: '1.1 m/s' },
        features: ['Automatic binding', 'Low stubble height'],
    },
    // ── Transport & Support ───────────────────────────────────────────────────
    {
        name: 'Tractor 50 HP (Mahindra)', type: 'tractor', category: CATEGORIES[5],
        description: 'Mahindra 475 DI 50 HP tractor, general purpose with power steering.',
        pricing: { baseRatePerDay: 3000, baseRatePerHour: 450, securityDeposit: 5000, operatorIncluded: false },
        location: { village: 'Suryapet', district: 'Suryapet', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.6212, 17.1383] } },
        images: ['https://images.unsplash.com/photo-1566927366571-cff023c06f6b?w=600'],
        specifications: { brand: 'Mahindra', model: '475 DI', hp: 50, engine: '4-cylinder diesel' },
        features: ['Power steering', 'Dual-clutch', 'PTO 540/1000 rpm'],
    },
    {
        name: 'Tractor 75 HP (New Holland)', type: 'tractor', category: CATEGORIES[5],
        description: 'New Holland 3630 TX 75 HP tractor with cab for heavy-duty operations.',
        pricing: { baseRatePerDay: 5000, baseRatePerHour: 700, securityDeposit: 8000, operatorIncluded: true },
        location: { village: 'Nalgonda', district: 'Nalgonda', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.2550, 17.0500] } },
        images: ['https://images.unsplash.com/photo-1605000797499-95a51c5269ae?w=600'],
        specifications: { brand: 'New Holland', model: '3630 TX', hp: 75 },
        features: ['AC cab', 'Electronic draft control', '4WD'],
    },
    {
        name: 'Tractor Trailer (5-ton)', type: 'tractor-trailer', category: CATEGORIES[5],
        description: '5-ton hydraulic tipping tractor trailer for farm produce transport.',
        pricing: { baseRatePerDay: 1500, baseRatePerHour: 200, securityDeposit: 2000, operatorIncluded: false },
        location: { village: 'Karimnagar', district: 'Karimnagar', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.1300, 18.4400] } },
        images: ['https://images.unsplash.com/photo-1592087046781-3c9d22a44d22?w=600'],
        specifications: { capacity: '5 tonnes', length: '4 m' },
        features: ['Hydraulic tipper', 'Heavy-duty axle'],
    },
    {
        name: 'Water Pump (Diesel, 3")', type: 'water-pump', category: CATEGORIES[5],
        description: '3-inch diesel water pump for irrigation from open wells and ponds.',
        pricing: { baseRatePerDay: 800, baseRatePerHour: 120, securityDeposit: 1000, operatorIncluded: false },
        location: { village: 'Wanaparthy', district: 'Wanaparthy', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.0630, 16.3620] } },
        images: ['https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=600'],
        specifications: { engine: '5 HP diesel', flow: '500 L/min', head: '25 m' },
        features: ['Self-priming', 'Portable skid-mounted'],
    },
    {
        name: 'Round Baler', type: 'baler', category: CATEGORIES[5],
        description: 'Round baler for wheat straw and paddy straw baling.',
        pricing: { baseRatePerDay: 4500, baseRatePerHour: 650, securityDeposit: 6000, operatorIncluded: true },
        location: { village: 'Jangaon', district: 'Jangaon', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.1510, 17.7240] } },
        images: ['https://images.unsplash.com/photo-1589923188900-85dae523342b?w=600'],
        specifications: { bale_diameter: '1.5 m', capacity: '100 bales/hr' },
        features: ['Variable chamber', 'Auto-tie mechanism'],
    },
    {
        name: 'Straw Reaper-cum-Binder', type: 'straw-reaper', category: CATEGORIES[5],
        description: 'Straw reaper that cuts and collects crop residue in one pass.',
        pricing: { baseRatePerDay: 2600, baseRatePerHour: 380, securityDeposit: 3500, operatorIncluded: false },
        location: { village: 'Bhupalpally', district: 'Jayashankar', state: 'Telangana', coordinates: { type: 'Point', coordinates: [79.8884, 18.4377] } },
        images: ['https://images.unsplash.com/photo-1560493676-04071c5f467b?w=600'],
        specifications: { cutting_width: '1.5 m', straw_capacity: '800 kg/hr' },
        features: ['Adjustable reel', 'Windrow attachment'],
    },
    {
        name: 'Knapsack Sprayer (Electric)', type: 'knapsack-sprayer', category: CATEGORIES[3],
        description: 'Battery-powered 16L knapsack sprayer for small plot pesticide application.',
        pricing: { baseRatePerDay: 400, baseRatePerHour: 60, securityDeposit: 500, operatorIncluded: false },
        location: { village: 'Sircilla', district: 'Rajanna Sircilla', state: 'Telangana', coordinates: { type: 'Point', coordinates: [78.8329, 18.3841] } },
        images: ['https://images.unsplash.com/photo-1592087046781-3c9d22a44d22?w=600'],
        specifications: { capacity: '16 L', battery: '12V 8Ah', pressure: '3–4 bar' },
        features: ['Li-ion battery', 'Adjustable nozzle', 'Lightweight'],
    },
    {
        name: 'Cultivator (9-Tyne)', type: 'cultivator', category: CATEGORIES[1],
        description: '9-tyne spring-loaded cultivator for inter-row cultivation and weed control.',
        pricing: { baseRatePerDay: 1200, baseRatePerHour: 170, securityDeposit: 1500, operatorIncluded: false },
        location: { village: 'Vikarabad', district: 'Vikarabad', state: 'Telangana', coordinates: { type: 'Point', coordinates: [77.9027, 17.3386] } },
        images: ['https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=600'],
        specifications: { tynes: 9, working_width: '1.8 m', working_depth: '12 cm' },
        features: ['Spring-loaded tynes', 'Adjustable sweep'],
    },
].map(m => ({ ...m, owner: ownerId, status: 'available', isActive: true, isApproved: true, ratings: { average: 0, count: 0 }, totalBookings: 0 }));


async function seed() {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Upsert users
    const createdUsers = {};
    for (const u of USERS) {
        const existing = await User.findOne({ email: u.email });
        if (existing) {
            console.log(`  ⏭️  User already exists: ${u.email}`);
            createdUsers[u.role] = existing;
        } else {
            const user = await User.create(u);
            console.log(`  ✅ Created user: ${u.email} (${u.role})`);
            createdUsers[u.role] = user;
        }
    }

    const owner = createdUsers.owner;
    if (!owner) {
        console.error('❌ Owner user not found — cannot seed machines');
        process.exit(1);
    }

    // Upsert machines
    const machines = makeMachines(owner._id);
    let created = 0, skipped = 0;
    for (const m of machines) {
        const existing = await Machine.findOne({ name: m.name, owner: owner._id });
        if (existing) { skipped++; continue; }
        await Machine.create(m);
        created++;
    }
    console.log(`  ✅ Machines: ${created} created, ${skipped} skipped`);

    console.log('\n🌱 Seed complete!');
    console.log('   Login: farmer@farmrent.in / Farmer@123');
    console.log('   Login: owner@farmrent.in  / Owner@123');
    console.log('   Login: admin@farmrent.in  / Admin@123');
    await mongoose.disconnect();
}

seed().catch(e => { console.error(e); process.exit(1); });
