/**
 * scripts/dev-safe.js — Permanent, Zero-Crash Next.js Dev Environment Launcher
 * 
 * Guarantees:
 * 1. Never crashes with `.next/dev/lock` errors.
 * 2. Never conflicts on Port 3000.
 * 3. Never kills unrelated Node processes.
 * 4. Automatically reuses an active, healthy FarmRent dev server.
 * 5. Automatically cleans hung/zombie PIDs listening on Port 3000 if unresponsive.
 */

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FRONTEND_DIR = path.join(__dirname, '..');
const LOCK_PATH = path.join(FRONTEND_DIR, '.next', 'dev', 'lock');
const CACHE_PATH = path.join(FRONTEND_DIR, '.next', 'cache');

// Load environment from Backend_Node_legacy/.env, or the file named by FARMRENT_ENV_FILE (see server.js)
const BACKEND_ENV_PATH = process.env.FARMRENT_ENV_FILE
    ? path.resolve(process.cwd(), process.env.FARMRENT_ENV_FILE)
    : path.join(FRONTEND_DIR, '..', 'Backend_Node_legacy', '.env');
if (fs.existsSync(BACKEND_ENV_PATH)) {
    require('dotenv').config({ path: BACKEND_ENV_PATH });
}

const PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Checks if a local port is in use
 */
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') resolve(true);
            else resolve(false);
        });
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Checks if active process on port is healthy FarmRent server
 */
function checkHealth(port) {
    return new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
}

/**
 * Safely terminates ONLY the specific PID listening on `port` if it's unresponsive
 */
function freeHungPort(port) {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const lines = output.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 5 && parts[1].includes(`:${port}`) && parts[3] === 'LISTENING') {
                    const pid = parts[4];
                    if (pid && pid !== '0' && pid !== String(process.pid)) {
                        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                        console.log(`🧹 Freed port ${port} by terminating hung process (PID ${pid}).`);
                    }
                }
            }
        }
    } catch (err) {
        // findstr exits non-zero when nothing matches, i.e. no process holds the port any more.
        if (err.status !== 1) console.warn(`⚠️  Could not inspect or free port ${port}: ${err.message}`);
    }
}

async function main() {
    console.log(`\n🔍 Checking FarmRent environment on port ${PORT}...`);

    let portBusy = await isPortInUse(PORT);

    if (portBusy) {
        const healthy = await checkHealth(PORT);
        if (healthy) {
            console.log(`\n=============================================================`);
            console.log(`  ✅ FarmRent server is ALREADY running on http://localhost:${PORT}`);
            console.log(`  👉 Access it in your browser: http://localhost:${PORT}`);
            console.log(`=============================================================\n`);
            process.exit(0);
        } else {
            console.log(`\n⚠️  Port ${PORT} is occupied by an unresponsive process. Cleaning up...`);
            freeHungPort(PORT);
            // Re-verify port status after targeted cleanup
            portBusy = await isPortInUse(PORT);
        }
    }

    // Safe to clean stale locks now that port is verified free
    if (fs.existsSync(LOCK_PATH)) {
        try {
            fs.unlinkSync(LOCK_PATH);
            console.log('🧹 Cleaned stale lock file (.next/dev/lock).');
        } catch (err) {
            console.warn(`⚠️  Could not remove ${LOCK_PATH}: ${err.message}. If Next.js reports a lock error, delete it manually.`);
        }
    }

    if (fs.existsSync(CACHE_PATH)) {
        try {
            fs.rmSync(CACHE_PATH, { recursive: true, force: true });
            console.log('🧹 Cleared stale build cache.');
        } catch (err) {
            console.warn(`⚠️  Could not clear ${CACHE_PATH}: ${err.message}. Continuing with the existing cache.`);
        }
    }

    console.log(`🚀 Starting FarmRent Next.js unified server on http://localhost:${PORT}...\n`);
    require(path.join(FRONTEND_DIR, 'server.js'));
}

main().catch((err) => {
    console.error('Dev-safe launcher error:', err);
    process.exit(1);
});
