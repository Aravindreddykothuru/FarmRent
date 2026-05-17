'use strict';

/**
 * Send a standardised success JSON response.
 * @param {import('express').Response} res
 * @param {*} data
 * @param {string} [message]
 * @param {number} [statusCode]
 */
const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
    });
};

/**
 * Create a well-formed error object that the global error handler can process.
 * @param {string} message
 * @param {number} [statusCode]
 * @param {object} [extra]  - extra fields merged into the error
 * @returns {Error}
 */
const createError = (message, statusCode = 500, extra = {}) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    Object.assign(err, extra);
    return err;
};

module.exports = { sendSuccess, createError };
