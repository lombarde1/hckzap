// routes/analyticsRoutes.js

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const analyticsController = require('../controllers/analyticsController');

// Rota para a página principal de analytics
router.get('/', ensureAuthenticated, analyticsController.getAnalytics);

// Rota para buscar dados do dashboard em tempo real
router.get('/dashboard-analytics', ensureAuthenticated, analyticsController.getDashboardAnalytics);

// Rota para buscar estatísticas específicas de instâncias
router.get('/instance/:instanceKey', ensureAuthenticated, analyticsController.getInstanceAnalytics);

// Rota para buscar estatísticas de funis
router.get('/funnels', ensureAuthenticated, analyticsController.getFunnelAnalytics);

// Rota para buscar estatísticas de localizações
router.get('/locations', ensureAuthenticated, analyticsController.getLocationAnalytics);

// Rota para buscar estatísticas de gatilhos populares
router.get('/triggers', ensureAuthenticated, analyticsController.getTriggerAnalytics);

// Exporta o router
module.exports = router;