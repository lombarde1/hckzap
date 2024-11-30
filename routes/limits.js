// routes/limits.js
const express = require('express');
const router = express.Router();
const limitsController = require('../controllers/limitsController');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');

// Rotas públicas (para o próprio usuário)
router.get('/my-limits', ensureAuthenticated, (req, res) => {
    limitsController.getUserLimits(req, res);
});

// Rotas administrativas
router.get('/user/:userId', ensureAdmin, limitsController.getUserLimits);
router.post('/custom', ensureAdmin, limitsController.setCustomLimit);
router.post('/temporary', ensureAdmin, limitsController.setTemporaryLimit);
router.post('/reset/:userId', ensureAdmin, limitsController.resetLimits);
router.get('/check', ensureAdmin, limitsController.checkLimit);

module.exports = router;