const path = require('path');
const supabase = require('../Backend/lib/supabase');
require('dotenv').config({ path: path.join(__dirname, '../Backend/.env') });

async function checkSystem() {
    try {
        console.log('Checking users...');
        const { data: users, error: uErr } = await supabase.from('users').select('id, email, role').limit(5);
        if (uErr) throw uErr;
        console.log('Users:', users);

        console.log('\nChecking drivers...');
        const { data: drivers, error: dErr } = await supabase.from('drivers').select('id, user_id, is_available').limit(5);
        if (dErr) throw dErr;
        console.log('Drivers:', drivers);

        console.log('\nChecking equipment...');
        const { data: eq, error: eErr } = await supabase.from('equipment').select('id, name, owner_id').limit(5);
        if (eErr) throw eErr;
        console.log('Equipment:', eq);

    } catch (e) {
        console.error('Error:', e.message);
    }
}

checkSystem();
