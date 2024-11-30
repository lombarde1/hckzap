const express = require('express');
const router = express.Router();
const cartpandaController = require('../controllers/cartPandaController');
const { ensureAuthenticated } = require('../middleware/auth');

// Rotas da interface
router.get('/status', ensureAuthenticated, cartpandaController.getCartpandaStatus);
router.post('/configure', ensureAuthenticated, cartpandaController.configureCartpanda);
router.post('/event', ensureAuthenticated, cartpandaController.updateEventConfig);

// Rota do webhook
router.post('/webhook/:webhookToken', cartpandaController.handleWebhook);

router.get('/config', (req, res) => {
    res.render('cartpanda', {user: req.user});
  });

module.exports = router;