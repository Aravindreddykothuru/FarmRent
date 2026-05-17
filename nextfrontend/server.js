/**
 * Single process: Next.js UI + Express API on one port (default 3000).
 * Run from nextfrontend: npm run dev | npm start
 */
const path = require('path');
const http = require('http');
const { parse } = require('url');

const FRONTEND_DIR = __dirname;
const BACKEND_ROOT = path.join(FRONTEND_DIR, '..', 'Backend');

// Remove stale Next.js dev lock so restarts never get stuck
try {
    const fs = require('fs');
    const lockPath = path.join(FRONTEND_DIR, '.next', 'dev', 'lock');
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
} catch (_) {}

process.chdir(BACKEND_ROOT);
require('dotenv').config({ path: path.join(BACKEND_ROOT, '.env') });

const { connectRedis } = require(path.join(BACKEND_ROOT, 'services', 'tracking-service', 'redisClient'));
const { buildBackendApplication } = require(path.join(BACKEND_ROOT, 'app'));
const { initializeSocket } = require(path.join(BACKEND_ROOT, 'services', 'tracking-service', 'socket'));

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

        const port = parseInt(process.env.PORT || '3000', 10);
        server.listen(port, () => {
            console.log(`> Ready on http://localhost:${port} (Next.js + API)`);
            console.log(`> Health: http://localhost:${port}/health`);
        });
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
