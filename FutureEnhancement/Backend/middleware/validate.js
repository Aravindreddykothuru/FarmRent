'use strict';

const { validationResult } = require('express-validator');
const { createError } = require('../utils/helpers');

/**
 * Validates request data using express-validator rules.
 * If validation fails, it throws a formatted 400 Bad Request error.
 */
const validate = (validations) => {
    return async (req, res, next) => {
        // Execute all validations
        await Promise.all(validations.map((val) => val.run(req)));

        const errors = validationResult(req);
        if (errors.isEmpty()) {
            return next();
        }

        // Format validation errors nicely
        const extractedErrors = {};
        errors.array().forEach((err) => {
            if (!extractedErrors[err.path]) {
                extractedErrors[err.path] = err.msg;
            }
        });

        // Pass validation error to the global error handler
        next(createError('Validation failed', 400, { validationErrors: extractedErrors }));
    };
};

module.exports = validate;
