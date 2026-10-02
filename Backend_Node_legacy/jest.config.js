/**
 * unit:        pure logic, no network — `npm run test:unit`
 * integration: real Express app against a real Postgres/PostgREST/Redis stack — `npm run test:integration`
 *              (start it with `docker compose up -d db rest gateway redis` and set FARMRENT_ENV_FILE)
 */
module.exports = {
    // Importing the app opens long-lived Redis and BullMQ connections (by design for the server) that expose no
    // shutdown hook, so Jest would otherwise wait forever after every suite has passed.
    forceExit: true,
    projects: [
        {
            displayName: 'unit',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/__tests__/unit/**/*.test.js'],
        },
        {
            displayName: 'integration',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/__tests__/integration/**/*.test.js'],
            setupFiles: ['<rootDir>/__tests__/integration/setupEnv.js'],
            setupFilesAfterEnv: ['<rootDir>/__tests__/integration/setupFramework.js'],
        },
    ],
};
