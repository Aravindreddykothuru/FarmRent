'use strict';

const router = require('express').Router();
const machineController = require('../controllers/machineController');
const { protect, optionalAuth, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const machineValidation = require('../validations/machineValidation');

// GET /api/v1/machines — list machines
router.get('/', optionalAuth, machineController.getMachines);

// GET /api/v1/machines/:id — get single machine
router.get('/:id', machineController.getMachine);

// POST /api/v1/machines — create a new machine listing (owner/admin only)
router.post(
    '/',
    protect,
    authorize('owner', 'admin'),
    validate(machineValidation.createMachine),
    machineController.createMachine
);

// PATCH /api/v1/machines/:id — update machine (owner/admin only)
router.patch(
    '/:id',
    protect,
    authorize('owner', 'admin'),
    validate(machineValidation.updateMachine),
    machineController.updateMachine
);

// DELETE /api/v1/machines/:id — soft delete (owner/admin only)
router.delete('/:id', protect, authorize('owner', 'admin'), machineController.deleteMachine);

module.exports = router;
