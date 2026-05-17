'use strict';

const { body } = require('express-validator');

const machineValidation = {
    createMachine: [
        body('name').trim().notEmpty().withMessage('Machine name is required'),
        body('type').trim().notEmpty().withMessage('Machine type is required'),
        body('description').trim().notEmpty().withMessage('Description is required'),
        body('pricing.baseRatePerDay')
            .isNumeric()
            .withMessage('pricing.baseRatePerDay is required and must be a number'),
        body('location.district').trim().notEmpty().withMessage('location.district is required'),
        body('status')
            .optional()
            .isIn(['available', 'booked', 'maintenance', 'inactive'])
            .withMessage('Invalid status value'),
    ],
    updateMachine: [
        body('pricing.baseRatePerDay')
            .optional()
            .isNumeric()
            .withMessage('pricing.baseRatePerDay must be a number'),
        body('status')
            .optional()
            .isIn(['available', 'booked', 'maintenance', 'inactive'])
            .withMessage('Invalid status value'),
    ],
};

module.exports = machineValidation;
