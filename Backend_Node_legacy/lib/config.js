const fs = require('fs');
const { z } = require('zod');
const logger = require('./logger');

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.preprocess((val) => Number(val || 3002), z.number()),
    JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters long'),
    JWT_REFRESH_SECRET: z.string().min(8, 'JWT_REFRESH_SECRET must be at least 8 characters long'),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),
    REDIS_URL: z.string().url('REDIS_URL must be a valid Redis URL').optional(),
    ALLOWED_ORIGINS: z.string().default('http://localhost:3002'),
});

let env;
try {
    // Collect variables to validate
    const envVars = {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
        REDIS_URL: process.env.REDIS_URL || undefined,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    };

    env = envSchema.parse(envVars);
} catch (error) {
    if (error instanceof z.ZodError) {
        const details = (error.issues || []).map((e) => ({ field: e.path.join('.'), message: e.message }));
        logger.error('❌ Environment configuration validation failed:', { details });
        // Exit process in production on validation failure to prevent degraded runtime states
        if (process.env.NODE_ENV === 'production') {
            // Straight to stderr, synchronously, before the exit that would otherwise throw this away. A
            // container that refuses to start has one job on its way out: name the setting that is wrong.
            // Without this the whole failure reaches the deploy log as an unrelated crash inside the logger,
            // and the deploy is debugged by guesswork.
            //
            // Field names and validation messages only — never the values, which are the secrets themselves.
            const report = details.map((d) => `  - ${d.field}: ${d.message}`).join('\n');
            fs.writeSync(2, `\nFarmRent cannot start: the environment is not configured correctly.\n${report}\n\n`);
            process.exit(1);
        }
    } else {
        logger.error('❌ Unknown configuration error:', { error: error.message });
    }
}

async function printStartupSummary() {
    // Wait for connection attempts to complete or fail
    await new Promise((resolve) => setTimeout(resolve, 800));

    const { redisClient } = require('../services/tracking-service/redisClient');
    const { isEsReady } = require('./elasticsearch');

    // Check Redis standard connection
    const redisConnected = redisClient && (redisClient.isOpen || redisClient.status === 'ready');
    const redisStatus = redisConnected ? 'connected' : 'disconnected';
    const queuesEnabled = process.env.REDIS_URL ? 'enabled' : 'disabled (REDIS_URL unset)';

    // Check S3 config
    const s3Configured = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    const s3Status = s3Configured ? 'connected' : 'not configured — using local storage';

    // Check ES config and status
    const esActive = await isEsReady().catch(() => false);
    const esStatus = esActive
        ? 'connected'
        : process.env.ELASTICSEARCH_NODE
          ? 'unreachable — using Postgres search'
          : 'not configured — using Postgres search';

    console.log('\n========================================================================');
    console.log(`[Startup] Redis: ${redisStatus} | Queues: ${queuesEnabled}`);
    console.log(`[Startup] S3: ${s3Status}`);
    console.log(`[Startup] Elasticsearch: ${esStatus}`);
    console.log('========================================================================\n');
}

if (process.env.NODE_ENV !== 'test') {
    printStartupSummary().catch(() => {});
}

module.exports = { env };
