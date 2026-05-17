const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { redisClient } = require('./services/tracking-service/redisClient');
const { auth } = require('./middleware/auth');
const { requireRole } = require('./middleware/requireRole');
const { errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');

// ── Rate limiters (free, no external service needed) ──────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
});

const paymentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Payment rate limit exceeded.' },
});

const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests.' },
});

/**
 * Express API app (no HTTP listen). Used by server.js and the unified Next+API server.
 */
function buildBackendApplication() {
    const app = express();

    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
        .split(',').map(s => s.trim()).filter(Boolean);
    app.use(cors({
        origin: (origin, cb) => {
            // Allow server-to-server (no origin) and whitelisted origins
            if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc:  ["'self'"],
                scriptSrc:   ["'self'", 'https://checkout.razorpay.com', 'https://api.razorpay.com'],
                styleSrc:    ["'self'", "'unsafe-inline'"],
                imgSrc:      ["'self'", 'data:', 'blob:', 'https:'],
                connectSrc:  ["'self'", 'wss:', 'https://api.razorpay.com'],
                frameSrc:    ["'none'"],
                objectSrc:   ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    }));
    app.use(requestLogger());
    app.use(cookieParser());
    // Webhooks require raw body for signature verification (Razorpay).
    app.use((req, res, next) => {
        if (req.originalUrl === '/api/payment/webhook') return next();
        return express.json()(req, res, next);
    });

    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

    const FLASK_URL = process.env.FLASK_URL || 'http://localhost:5001';
    app.use('/api/v2', createProxyMiddleware({
        target: FLASK_URL,
        changeOrigin: true,
        pathRewrite: { '^/api/v2': '/api' },
    }));

    // ── Auth (rate-limited) ───────────────────────────────────────────────────
    app.use('/api/v1/auth', authLimiter, require('./services/auth-service/routes'));

    // ── Payment (rate-limited) ────────────────────────────────────────────────
    app.use('/api/payment', paymentLimiter, require('./routes/payment'));

    // ── Core routes ───────────────────────────────────────────────────────────
    app.use('/api/v1/users',      require('./services/user-service/routes'));
    app.use('/api/v1/equipment',  require('./services/equipment-service/routes'));
    app.use('/api/v1/machines',   auth(false), require('./routes/machines'));
    app.use('/api/v1/search',     auth(false), require('./routes/search'));
    app.use('/api/v1/bookings',   auth(false), require('./services/booking-service/routes'));
    app.use('/api/v1/reviews',    require('./routes/reviews'));
    app.use('/api/v1/payments',   require('./services/payment-service/routes'));
    app.use('/api/v1/drivers',    require('./services/driver-service/routes'));
    app.use('/api/v1/tracking',   require('./services/tracking-service/routes'));
    app.use('/api/v1/upload',     require('./routes/upload'));
    app.use('/api/v1/admin',      auth(true), requireRole('admin'), require('./routes/admin'));
    app.use('/api/v1/notifications', auth(true), require('./routes/notifications'));

    // ── Phase 2–3 routes ──────────────────────────────────────────────────────
    app.use('/api/v1/messages',   auth(true), require('./routes/messages'));
    app.use('/api/v1/invoices',   auth(true), require('./routes/invoices'));
    app.use('/api/v1/kyc',        auth(true), require('./routes/kyc'));
    app.use('/api/v1/disputes',   auth(true), require('./routes/disputes'));
    app.use('/api/v1/favorites',     auth(true), require('./routes/favorites'));
    app.use('/api/v1/offers',        auth(true), require('./routes/offers'));
    app.use('/api/v1/saved-searches', auth(true), require('./routes/saved-searches'));

    // ── General rate limiter (applied last, after specific routes) ────────────
    app.use('/api/v1', generalLimiter);

    // ── Health checks ─────────────────────────────────────────────────────────
    app.get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: 'api',
            timestamp: new Date().toISOString(),
        });
    });

    app.get('/health', (req, res) => {
        const redis = {
            isOpen: Boolean(redisClient?.isOpen),
            isReady: Boolean(redisClient?.isReady),
        };
        const ok = redis.isReady || !redis.isOpen;
        res.status(200).json({
            status: ok ? 'healthy' : 'degraded',
            service: 'API Gateway',
            timestamp: new Date().toISOString(),
            dependencies: { redis },
        });
    });

    app.get('/health/full', async (req, res) => {
        const redis = {
            isOpen: Boolean(redisClient?.isOpen),
            isReady: Boolean(redisClient?.isReady),
        };
        const flaskBaseUrl = process.env.FLASK_URL || 'http://localhost:5001';
        const flaskHealthUrl = `${flaskBaseUrl.replace(/\/$/, '')}/api/health`;

        let flask = { configuredUrl: flaskBaseUrl, reachable: false, status: null };
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1200);
            const r = await fetch(flaskHealthUrl, { signal: controller.signal });
            clearTimeout(timeout);
            flask = { ...flask, reachable: r.ok, status: r.status };
        } catch (_) {
            // Flask optional
        }

        const ok = redis.isReady || !redis.isOpen;
        res.status(ok ? 200 : 503).json({
            status: ok ? 'healthy' : 'degraded',
            service: 'API Gateway',
            timestamp: new Date().toISOString(),
            runtime: {
                node: process.version,
                uptimeSeconds: Math.round(process.uptime()),
            },
            dependencies: { redis, flask },
        });
    });

    // ── Dev email inbox (disabled in production) ──────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
        app.use('/api/dev/emails', require('./routes/devEmails'));
    }

    app.use((req, res) => {
        res.status(404).json({ status: 'error', message: 'Endpoint not found' });
    });

    app.use(errorHandler);

    return app;
}

module.exports = { buildBackendApplication };
