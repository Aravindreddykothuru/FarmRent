const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../Backend/.env') });
const { createClient } = require('@supabase/supabase-client');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyOptimization() {
    const sqlPath = path.join(__dirname, '../Backend/supabase/optimize_spatial.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying SQL optimization...');
    
    // We split by ';' and execute loosely if possible, 
    // but better to just use the one script if it's DDL and we have service role.
    // However, supabase-js doesn't have a direct raw SQL execution.
    // We MUST use the Supabase Dashboard or an MCP tool that works.
    
    // Wait, I can try to use standard queries if they are simple, 
    // but DDL requires raw SQL.
    
    console.log('NOTICE: Supabase-js cannot execute raw DDL (CREATE FUNCTION).');
    console.log('Please run the contents of Backend/supabase/optimize_spatial.sql in your Supabase SQL Editor.');
    
    // However, I'll still TRY to run a simple RPC to check if I can at least verify existence.
}

applyOptimization();
