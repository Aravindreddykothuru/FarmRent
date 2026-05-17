const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

// Load .env from the same directory
dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_KEY missing in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConnection() {
  try {
    const { error } = await supabase.from('_prisma_migrations').select('*').limit(1);
    if (error) {
      console.error('Supabase Connection Error:', error.message);
      process.exit(1);
    }
    console.log('Supabase Connection: SUCCESS');
    console.log('Data fetched successfully from _prisma_migrations');
    process.exit(0);
  } catch (err) {
    console.error('Unexpected Error:', err.message);
    process.exit(1);
  }
}

checkConnection();
