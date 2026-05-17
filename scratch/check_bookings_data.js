require('dotenv').config({ path: '../Backend/.env' });
const { createClient } = require('@supabase/supabase-client');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBookings() {
    const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .limit(5);
    
    if (error) {
        console.error('Error fetching bookings:', error);
        return;
    }
    
    console.log('Sample Bookings Data:');
    console.dir(data, { depth: null });
}

checkBookings();
