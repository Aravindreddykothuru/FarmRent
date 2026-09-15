const path = require('path');
require('./lib/config'); // Validate environment configuration at launch
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { authLimiter, paymentLimiter, generalLimiter } = require('./middleware/redisRateLimiter');
const { redisClient } = require('./services/tracking-service/redisClient');
const supabase = require('./lib/supabase');
const { HttpError } = require('./lib/httpError');
const { auth } = require('./middleware/auth');
const { requireRole } = require('./middleware/requireRole');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const { responseEnvelope } = require('./middleware/responseEnvelope');

/**
 * Express API app (no HTTP listen). Used by server.js and the unified Next+API server.
 */
function buildBackendApplication() {
    const app = express();
    const { client, metricsMiddleware } = require('./lib/metrics');

    // Behind a load balancer / reverse proxy set TRUST_PROXY (e.g. 1) so req.ip — used for rate
    // limiting and session records — is the client address rather than the proxy's.
    if (process.env.TRUST_PROXY) {
        const hops = Number(process.env.TRUST_PROXY);
        app.set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
    }

    app.use(metricsMiddleware);

    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3002,http://localhost:3000')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const isDev = process.env.NODE_ENV !== 'production';
    app.use(
        cors({
            origin: (origin, cb) => {
                // Allow server-to-server (no origin) and whitelisted origins
                if (!origin) return cb(null, true);
                if (allowedOrigins.includes(origin)) return cb(null, true);
                // In dev, allow any localhost/127.0.0.1 or localtunnel / ngrok proxy
                if (
                    isDev &&
                    (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
                        origin.endsWith('.loca.lt') ||
                        origin.endsWith('.ngrok.io') ||
                        origin.endsWith('.ngrok-free.app'))
                )
                    return cb(null, true);
                cb(new HttpError(403, 'CORS_ORIGIN_DENIED', `Origin ${origin} is not allowed`));
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'],
        }),
    );

    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://api.razorpay.com'],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
                    connectSrc: ["'self'", 'wss:', 'https://api.razorpay.com'],
                    frameSrc: ["'none'"],
                    objectSrc: ["'none'"],
                },
            },
            crossOriginEmbedderPolicy: false,
        }),
    );
    app.use(requestLogger());
    app.use(responseEnvelope());
    app.use(cookieParser());
    // Webhooks require raw body for signature verification (Razorpay).
    app.use((req, res, next) => {
        if (req.originalUrl.startsWith('/api/payment/webhook')) return next();
        return express.json({ limit: '1mb' })(req, res, next);
    });

    // KYC uploads are identity documents: they are never served as public static files.
    app.use('/uploads/kyc', (req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    // ── Auth (rate-limited) ───────────────────────────────────────────────────
    // Credential endpoints (login, register, password reset, OTP) keep the strict per-IP auth limit. Session
    // endpoints called on every page load (/me, /refresh, /logout, /sessions) get the general API limit.
    const SESSION_ENDPOINT = /^\/(me|refresh|logout|sessions)(\/|$)/;
    const authRouteLimiter = (req, res, next) => (SESSION_ENDPOINT.test(req.path) ? generalLimiter : authLimiter)(req, res, next);
    app.use('/api/v1/auth', authRouteLimiter, require('./services/auth-service/routes'));

    // ── Payment (rate-limited) ────────────────────────────────────────────────
    // Razorpay webhooks are signature-verified and may arrive in bursts, so they skip the per-IP limiter.
    app.use(
        '/api/payment',
        (req, res, next) => (req.path === '/webhook' ? next() : paymentLimiter(req, res, next)),
        require('./services/payment-service/routes'),
    );

    // ── General rate limiter (applied to all core v1 routes) ──────────────────
    app.use('/api/v1', generalLimiter);

    // ── Core routes ───────────────────────────────────────────────────────────
    app.use('/api/v1/users', require('./services/user-service/routes'));
    app.use('/api/v1/machines', auth(false), require('./routes/machines'));
    app.use('/api/v1/search', auth(false), require('./services/search-service/routes'));
    app.use('/api/v1/bookings', auth(false), require('./services/booking-service/routes'));
    app.use('/api/v1/reviews', require('./routes/reviews'));
    app.use('/api/v1/drivers', require('./services/driver-service/routes'));
    app.use('/api/v1/tracking', require('./services/tracking-service/routes'));
    app.use('/api/v1/upload', require('./routes/upload'));
    // Initialize and start background workers
    require('./workers/invoiceWorker');
    require('./workers/cronWorker');
    require('./workers/imageWorker');

    app.use('/api/v1/admin', auth(true), requireRole('admin'), require('./services/admin-service/routes'));
    const { queuesRouter } = require('./lib/queueManager');
    app.use('/api/v1/admin/queues', auth(true), requireRole('admin'), queuesRouter);
    app.use('/api/v1/notifications', auth(true), require('./services/notification-service/routes'));
    app.use('/api/v1/ml', require('./routes/ml'));
    app.use('/api/v1/stats', require('./routes/stats'));
    app.use('/api/v1/weather', require('./services/weather-service/routes'));
    app.use('/api/v1/analytics', require('./services/analytics-service/routes'));

    // ── Phase 2–3 routes ──────────────────────────────────────────────────────
    app.use('/api/v1/messages', auth(true), require('./routes/messages'));
    app.use('/api/v1/invoices', auth(true), require('./routes/invoices'));
    app.use('/api/v1/kyc', auth(true), require('./routes/kyc'));
    app.use('/api/v1/disputes', auth(true), require('./routes/disputes'));
    app.use('/api/v1/favorites', auth(true), require('./routes/favorites'));
    app.use('/api/v1/offers', auth(true), require('./routes/offers'));
    app.use('/api/v1/saved-searches', auth(true), require('./routes/saved-searches'));

    // ── Swagger API Documentation ───────────────────────────────────────────
    const { swaggerUi, swaggerSpec } = require('./lib/swagger');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    // ── Prometheus Metrics ───────────────────────────────────────────────────
    // Set METRICS_TOKEN to require `Authorization: Bearer <token>` (recommended in production).
    app.get('/metrics', async (req, res, next) => {
        const token = process.env.METRICS_TOKEN;
        if (token && req.headers.authorization !== `Bearer ${token}`) {
            return res.status(401).json({ status: 'error', message: 'Unauthorized' });
        }
        try {
            res.set('Content-Type', client.register.contentType);
            res.end(await client.register.metrics());
        } catch (err) {
            next(err);
        }
    });

    // ── Health checks ─────────────────────────────────────────────────────────
    const redisState = () => ({ isOpen: Boolean(redisClient?.isOpen), isReady: Boolean(redisClient?.isReady) });

    // Liveness: the process is up and serving requests.
    app.get(['/health', '/api/health', '/api/v1/health'], (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'API Gateway',
            timestamp: new Date().toISOString(),
            dependencies: { redis: redisState() },
        });
    });

    // Readiness: the database answers a query. Redis is optional (in-memory fallbacks exist).
    app.get('/health/full', async (req, res) => {
        const started = Date.now();
        let database = { reachable: false };
        if (supabase) {
            try {
                const { error } = await supabase.from('roles').select('id').limit(1);
                database = error ? { reachable: false, error: error.message } : { reachable: true, latencyMs: Date.now() - started };
            } catch (err) {
                database = { reachable: false, error: err.message };
            }
        } else {
            database = { reachable: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' };
        }

        res.status(database.reachable ? 200 : 503).json({
            status: database.reachable ? 'healthy' : 'unhealthy',
            service: 'API Gateway',
            timestamp: new Date().toISOString(),
            runtime: {
                node: process.version,
                uptimeSeconds: Math.round(process.uptime()),
            },
            dependencies: { database, redis: redisState() },
        });
    });

    // ── Dev email inbox (disabled in production) ──────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
        app.use('/api/dev/emails', require('./routes/devEmails'));
    }

    app.use((req, res) => {
        res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Endpoint not found' });
    });

    app.use(errorHandler);

    return app;
}

module.exports = { buildBackendApplication };
