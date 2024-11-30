// routes/pushinPay.js
const express = require('express');
const router = express.Router();
const pushinPayController = require('../controllers/pushinPayController');
const { ensureAuthenticated } = require('../middleware/auth');

// Rotas da API
router.get('/status', ensureAuthenticated, pushinPayController.getPushinPayStatus);
router.post('/configure', ensureAuthenticated, pushinPayController.configurePushinPay);
router.post('/generate-pix', ensureAuthenticated, pushinPayController.generatePixPayment);

// Rota do webhook
router.post('/webhook/:token', pushinPayController.handleWebhook);

// Rota da interface (se necessário)
router.get('/config', ensureAuthenticated, (req, res) => {
  res.render('pushinpay-config', { user: req.user });
});

module.exports = router;