const client = require('prom-client');

// Enable default system metrics collection (CPU, Memory, etc.)
client.collectDefaultMetrics({ register: client.register });

// 1. HTTP Request Latency Histogram
const httpRequestDurationMicroseconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 10], // seconds
});

// 2. HTTP Requests Counter
const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests processed',
    labelNames: ['method', 'route', 'status_code'],
});

// 3. Active Socket.io Connections Gauge
const activeConnections = new client.Gauge({
    name: 'socket_active_connections_total',
    help: 'Total number of active tracking socket connections',
});

// 4. Database Query Duration Histogram
const databaseQueryDuration = new client.Histogram({
    name: 'database_query_duration_seconds',
    help: 'Duration of Supabase/PostgreSQL queries in seconds',
    labelNames: ['operation', 'table'],
});

// 5. BullMQ Queue Status Gauge
const queueSize = new client.Gauge({
    name: 'bullmq_queue_jobs_total',
    help: 'Total number of jobs in BullMQ queues',
    labelNames: ['queue_name', 'status'], // status: active, waiting, delayed, failed
});

/**
 * Express middleware to record request metrics
 */
const metricsMiddleware = (req, res, next) => {
    const start = process.hrtime();

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const duration = diff[0] + diff[1] / 1e9; // convert to seconds

        // Skip scraping requests
        if (req.path === '/metrics') return;

        const route = req.route ? req.route.path : req.path;
        const labels = {
            method: req.method,
            route: route || 'unknown',
            status_code: res.statusCode,
        };

        httpRequestDurationMicroseconds.observe(labels, duration);
        httpRequestsTotal.inc(labels);
    });

    next();
};

module.exports = {
    client,
    httpRequestDurationMicroseconds,
    httpRequestsTotal,
    activeConnections,
    databaseQueryDuration,
    queueSize,
    metricsMiddleware,
};
