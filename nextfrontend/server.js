/**
 * Single process: Next.js UI + Express API on one port (default 3000).
 * Run from nextfrontend: npm run dev | npm start
 */
const path = require('path');
const http = require('http');
const { parse } = require('url');

const FRONTEND_DIR = __dirname;
const BACKEND_ROOT = path.join(FRONTEND_DIR, '..', 'Backend_Node_legacy');

// Note: Port availability checking & stale lock cleanup are safely handled in scripts/dev-safe.js

// FARMRENT_ENV_FILE selects an alternate env file (e.g. the local Docker stack) without editing .env.
const ENV_FILE = process.env.FARMRENT_ENV_FILE
    ? path.resolve(process.cwd(), process.env.FARMRENT_ENV_FILE)
    : path.join(BACKEND_ROOT, '.env');

process.chdir(BACKEND_ROOT);
require('dotenv').config({ path: ENV_FILE });

const { connectRedis, redisClient, pubClient, subClient } = require(path.join(BACKEND_ROOT, 'services', 'tracking-service', 'redisClient'));
const { buildBackendApplication } = require(path.join(BACKEND_ROOT, 'app'));
const { initializeSocket, getIo, isSocketReady } = require(path.join(BACKEND_ROOT, 'services', 'tracking-service', 'socket'));

connectRedis();

const backendApp = buildBackendApplication();

const dev = process.env.NODE_ENV !== 'production';
const next = require('next');
// Disable Turbopack in dev — avoids the lucide-react barrel-file HMR chunk bug
if (dev) process.env.TURBOPACK = '0';
const nextApp = next({ dev, dir: FRONTEND_DIR });

function isBackendPath(pathname) {
    return (
        pathname.startsWith('/api') ||
        pathname === '/health' ||
        pathname.startsWith('/health/') ||
        pathname.startsWith('/uploads') ||
        pathname.startsWith('/socket.io')
    );
}

nextApp
    .prepare()
    .then(() => {
        const handle = nextApp.getRequestHandler();

        const server = http.createServer((req, res) => {
            const parsed = parse(req.url, true);
            const pathname = parsed.pathname || '';

            if (isBackendPath(pathname)) {
                return backendApp(req, res);
            }
            return handle(req, res, parsed);
        });

        initializeSocket(server);

        // Default to port 3000 (or PORT env var)
        const port = parseInt(process.env.PORT || '3000', 10);

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`\n[ERROR] Port ${port} is already in use.`);
                console.error(`[ERROR] Kill the existing process first:\n`);
                console.error(`  Windows cmd:   taskkill /IM node.exe /F`);
                console.error(`  PowerShell:    Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force\n`);
                process.exit(1);
            } else {
                console.error(err);
                process.exit(1);
            }
        });

        server.listen(port, () => {
            console.log(`> Ready on http://localhost:${port} (Next.js + API)`);
            console.log(`> Health: http://localhost:${port}/health`);
        });

        // Graceful shutdown (container stop, rolling deploy): stop accepting connections, let in-flight requests
        // finish, release Redis, then exit. Queue workers register their own SIGTERM listeners, which removes
        // Node's default exit-on-signal — without this the process would linger until it is killed.
        const SHUTDOWN_TIMEOUT_MS = 8000; // inside Docker's default 10 s stop window
        let shuttingDown = false;
        const shutdown = (signal) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`> ${signal} received, shutting down`);
            setTimeout(() => {
                console.error('> Shutdown timed out, exiting');
                process.exit(1);
            }, SHUTDOWN_TIMEOUT_MS).unref();

            // io.close() also closes the HTTP server it is attached to.
            new Promise((resolve) => (isSocketReady() ? getIo().close(() => resolve()) : server.close(() => resolve())))
                .then(() => Promise.allSettled([redisClient, pubClient, subClient].filter((c) => c.isOpen).map((c) => c.quit())))
                .then(() => {
                    console.log('> Shutdown complete');
                    process.exit(0);
                })
                .catch((err) => {
                    console.error('> Shutdown failed', err);
                    process.exit(1);
                });
        };
        process.once('SIGTERM', () => shutdown('SIGTERM'));
        process.once('SIGINT', () => shutdown('SIGINT'));
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
