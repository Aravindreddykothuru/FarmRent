require('dotenv').config({ path: '../.env' });
const supabase = require('../lib/supabase');
const { indexMachine, isEsReady } = require('../lib/elasticsearch');
const logger = require('../lib/logger');

async function syncAll() {
    logger.info('[sync-es] Starting data synchronization...');

    if (!supabase) {
        logger.error('[sync-es] Database client is not initialized');
        process.exit(1);
    }

    if (!(await isEsReady())) {
        logger.error('[sync-es] Elasticsearch client is not active or reachable. Exiting.');
        process.exit(1);
    }

    const { data: machines, error } = await supabase.from('equipment').select('*').eq('is_verified', true);

    if (error) {
        logger.error('[sync-es] Failed to fetch equipment from database:', { error: error.message });
        process.exit(1);
    }

    logger.info(`[sync-es] Found ${machines?.length || 0} verified machines. Syncing...`);

    for (const machine of machines || []) {
        await indexMachine(machine);
    }

    logger.info('[sync-es] Elasticsearch synchronization completed successfully.');
    process.exit(0);
}

syncAll().catch((err) => {
    logger.error('[sync-es] Fatal sync crash:', { error: err.message });
    process.exit(1);
});
