const express = require('express');
const router = express.Router();

// Kept for backwards compatibility with existing route mount:
// app.use('/api/v1/payments', require('./services/payment-service/routes'));
//
// The live Razorpay implementation is under /api/payment/*.

router.get('/', (req, res) => {
    res.json({ message: 'Payment Service Online' });
});

router.post('/initiate', (req, res) => {
    return res.status(410).json({
        status: 'error',
        message: 'Deprecated. Use POST /api/payment/create-order for live Razorpay payments.',
    });
});

router.post('/confirm', (req, res) => {
    return res.status(410).json({
        status: 'error',
        message: 'Deprecated. Use POST /api/payment/verify for live Razorpay payments.',
    });
});

router.post('/refund', (req, res) => {
    return res.status(410).json({
        status: 'error',
        message: 'Refunds are not implemented. Handle via Razorpay dashboard/webhooks.',
    });
});

router.post('/validate-card', (req, res) => {
    return res.status(410).json({
        status: 'error',
        message: 'Deprecated. Live payments use Razorpay Checkout.',
    });
});

module.exports = router;

