'use strict';

const { Router } = require('express');
const devStore   = require('../lib/devEmailStore');

const router = Router();

// Only active in development
if (process.env.NODE_ENV !== 'production') {
    router.get('/',      (_req, res) => res.json(devStore.getAll()));
    router.delete('/',   (_req, res) => { devStore.clear(); res.json({ ok: true }); });
}

module.exports = router;
