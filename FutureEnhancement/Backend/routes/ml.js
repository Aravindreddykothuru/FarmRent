'use strict';

const router = require('express').Router();
const mlController = require('../controllers/mlController');

/**
 * ML Route definitions
 * All routes are under /api/v1/ml
 */

// GET /api/v1/ml/demand-prediction?district=&machineType=&daysAhead=
router.get('/demand-prediction', mlController.getDemandPrediction);

// GET /api/v1/ml/recommendations?cropType=&fieldSize=&district=&budget=&date=
router.get('/recommendations', mlController.getMachineRecommendations);

// POST /api/v1/ml/optimal-pricing
router.post('/optimal-pricing', mlController.getOptimalPricing);

// GET /api/v1/ml/churn-risk  (Admin only)
router.get('/churn-risk', mlController.getChurnRisk);

module.exports = router;
