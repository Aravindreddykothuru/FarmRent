'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Server: SocketIOServer } = require('socket.io');

const connectDB = require('./config/database');
const logger = require('./utils/logger');
const initCronJobs = require('./utils/cronJobs');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/logger');
const cache = require('./utils/cacheManager');

// Route imports
const authRoutes = require('./routes/auth');
const machineRoutes = require('./routes/machines');
const bookingRoutes = require('./routes/bookings');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const mlRoutes = require('./routes/ml');
const searchRoutes = require('./routes/search');
const reviewRoutes = require('./routes/reviews');
const razorpayRoutes = require('./routes/razorpay');
const stripeRoutes = require('./routes/stripe');
const { router: notificationRoutes } = require('./routes/notifications');
const uploadRoutes = require('./routes/upload');

const app = express();
const httpServer = http.createServer(app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        methods: ['GET', 'POST'],
    },
});

// Attach io to app so routes can emit events
app.set('io', io);

io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Join a room for a specific booking so both parties get updates
    socket.on('join:booking', (bookingId) => {
        socket.join(`booking:${bookingId}`);
    });

    socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
    });
});

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Global Rate Limiter ───────────────────────────────────────────────────────
app.use(rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
}));

// ─── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static uploads ───────────────────────────────────────────────────────────
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── HTTP Request Logging ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined', {
        stream: { write: (msg) => logger.http(msg.trim()) },
    }));
}
app.use(requestLogger);

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: '2.0.0',
        services: {
            cache: cache.getStats(),
            flask: `http://localhost:${process.env.FLASK_PORT || 5001}`,
            websocket: 'active',
        },
    });
});

// ─── API Routes (Node.js) ─────────────────────────────────────────────────────
const API_PREFIX = '/api/v1';

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/machines`, machineRoutes);
app.use(`${API_PREFIX}/bookings`, bookingRoutes);
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/ml`, mlRoutes);
app.use(`${API_PREFIX}/search`, searchRoutes);
app.use(`${API_PREFIX}/reviews`, reviewRoutes);
app.use(`${API_PREFIX}/razorpay`, razorpayRoutes);
app.use(`${API_PREFIX}/stripe`, stripeRoutes);
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/upload`, uploadRoutes);

// ─── Proxy → Flask Micro-service (FutureEnhancement) ─────────────────────────
const FLASK_URL = process.env.FLASK_URL || `http://localhost:${process.env.FLASK_PORT || 5001}`;

app.use('/api/v2', createProxyMiddleware({
    target: FLASK_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/v2': '/api' },
    on: {
        error: (err, req, res) => {
            logger.error(`Flask proxy error: ${err.message}`);
            res.status(502).json({ success: false, message: 'Enhancement service unavailable', detail: err.message });
        },
    },
}));

// ─── API Index ────────────────────────────────────────────────────────────────
app.get(`${API_PREFIX}`, (req, res) => {
    res.json({
        name: 'FarmRent API',
        version: '2.0.0',
        endpoints: {
            auth: `${API_PREFIX}/auth`,
            machines: `${API_PREFIX}/machines`,
            bookings: `${API_PREFIX}/bookings`,
            payments: `${API_PREFIX}/payments`,
            admin: `${API_PREFIX}/admin`,
            reviews: `${API_PREFIX}/reviews`,
            razorpay: `${API_PREFIX}/razorpay`,
            search: `${API_PREFIX}/search`,
            ml: `${API_PREFIX}/ml`,
            gps: '/api/v2/gps',
        },
    });
});

// ─── Error Handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const startServer = async () => {
    await connectDB();

    await cache.connect().catch((err) => {
        logger.warn(`Cache unavailable: ${err.message} — running without cache`);
    });

    httpServer.listen(PORT, () => {
        logger.info(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV}]`);
        logger.info(`📡 API:      http://localhost:${PORT}${API_PREFIX}`);
        logger.info(`🔌 WS:       ws://localhost:${PORT}`);
        logger.info(`🔀 Flask:    http://localhost:${PORT}/api/v2 → ${FLASK_URL}/api`);
        logger.info(`❤️  Health:  http://localhost:${PORT}/health`);
    });

    initCronJobs();

    const shutdown = (signal) => {
        logger.info(`${signal} received. Shutting down gracefully...`);
        httpServer.close(async () => {
            await cache.disconnect();
            logger.info('HTTP server closed');
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled Promise Rejection:', reason);
        shutdown('Unhandled Rejection');
    });
};

startServer();

module.exports = app;
