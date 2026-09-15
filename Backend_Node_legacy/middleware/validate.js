const { ZodError } = require('zod');

function validate(schema, target = 'body') {
    return (req, res, next) => {
        try {
            req[target] = schema.parse(req[target]);
            next();
        } catch (err) {
            if (err instanceof ZodError) {
                const issues = err.issues || err.errors || [];
                return res.status(400).json({
                    status: 'error',
                    code: 'VALIDATION_ERROR',
                    message: 'Validation failed',
                    errors: issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
                });
            }
            next(err);
        }
    };
}

module.exports = { validate };
