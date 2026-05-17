'use strict';

const cluster = require('cluster');
const os = require('os');
const logger = require('./utils/logger');

/**
 * Cluster Manager
 * Scales the API across all available CPU cores for maximum throughput
 *
 * Benefits:
 * - Utilizes all CPU cores (Node.js is single-threaded per process)
 * - Zero-downtime restarts (rolling worker replacement)
 * - Automatic worker recovery from crashes
 * - Load balanced by the OS kernel (round-robin)
 */
class ClusterManager {
  constructor() {
    this.numWorkers = parseInt(process.env.WORKER_COUNT) || os.cpus().length;
    this.workers = new Map();
    this.isShuttingDown = false;
    this.workerRestarts = new Map();
    this.MAX_RESTARTS = 10;
    this.RESTART_WINDOW_MS = 60000; // Restart tracking window
  }

  start() {
    if (cluster.isPrimary) {
      this.startPrimary();
    } else {
      this.startWorker();
    }
  }

  startPrimary() {
    logger.info(`🚀 Master process ${process.pid} starting ${this.numWorkers} workers`);

    // Fork workers
    for (let i = 0; i < this.numWorkers; i++) {
      this.forkWorker();
    }

    // Handle worker exit and restart
    cluster.on('exit', (worker, code, signal) => {
      const id = worker.id;
      this.workers.delete(id);

      if (this.isShuttingDown) {
        logger.info(`Worker ${id} stopped (shutdown in progress)`);
        return;
      }

      logger.warn(`Worker ${id} died (code: ${code}, signal: ${signal})`);

      // Check restart rate to avoid restart loops
      if (this.shouldRestartWorker(id)) {
        logger.info(`Restarting worker ${id}...`);
        setTimeout(() => this.forkWorker(), 1000);
      } else {
        logger.error(`Worker ${id} exceeded max restarts. Not restarting.`);
      }
    });

    cluster.on('online', (worker) => {
      logger.info(`Worker ${worker.id} (PID: ${worker.process.pid}) is online`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    // Zero-downtime rolling restart
    process.on('SIGUSR2', () => this.rollingRestart());

    // Health monitoring
    setInterval(() => this.healthCheck(), 30000);

    logger.info(`✅ Cluster ready — ${this.numWorkers} workers active`);
  }

  startWorker() {
    // Worker process loads the actual Express app
    require('./server');

    logger.info(`Worker ${cluster.worker.id} (PID: ${process.pid}) started`);
  }

  forkWorker() {
    const worker = cluster.fork();
    this.workers.set(worker.id, worker);
    this.workerRestarts.set(worker.id, []);

    // Handle messages from workers (IPC)
    worker.on('message', (msg) => {
      if (msg.type === 'health') {
        logger.debug(`Worker ${worker.id} health: ${JSON.stringify(msg.data)}`);
      }
    });

    return worker;
  }

  shouldRestartWorker(workerId) {
    const now = Date.now();
    const restarts = this.workerRestarts.get(workerId) || [];

    // Clean old restart timestamps
    const recent = restarts.filter((t) => now - t < this.RESTART_WINDOW_MS);
    recent.push(now);
    this.workerRestarts.set(workerId, recent);

    return recent.length <= this.MAX_RESTARTS;
  }

  /**
   * Zero-downtime rolling restart
   * Restarts workers one by one while keeping others live
   */
  async rollingRestart() {
    logger.info('🔄 Starting rolling restart...');
    const workerIds = [...this.workers.keys()];

    for (const id of workerIds) {
      const worker = this.workers.get(id);
      if (!worker) continue;

      // Disconnect worker gracefully
      worker.disconnect();

      await new Promise((resolve) => {
        worker.on('exit', () => {
          const newWorker = this.forkWorker();
          newWorker.on('online', () => {
            logger.info(`Rolled: Worker ${id} → Worker ${newWorker.id}`);
            setTimeout(resolve, 1000); // Small delay between restarts
          });
        });
      });
    }

    logger.info('✅ Rolling restart complete');
  }

  async gracefulShutdown(signal) {
    logger.info(`${signal} received — graceful cluster shutdown starting...`);
    this.isShuttingDown = true;

    const workers = [...this.workers.values()];

    await Promise.all(
      workers.map(
        (worker) =>
          new Promise((resolve) => {
            worker.send({ type: 'shutdown' });
            worker.on('exit', resolve);
            // Force kill after 10s
            setTimeout(() => {
              worker.kill('SIGKILL');
              resolve();
            }, 10000);
          })
      )
    );

    logger.info('All workers stopped. Exiting master.');
    process.exit(0);
  }

  healthCheck() {
    const alive = this.workers.size;
    if (alive < this.numWorkers) {
      logger.warn(`Health check: Only ${alive}/${this.numWorkers} workers alive`);
    }
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
if (process.env.CLUSTER_MODE === 'true') {
  const manager = new ClusterManager();
  manager.start();
} else {
  // Single process mode (development)
  require('./server');
}
