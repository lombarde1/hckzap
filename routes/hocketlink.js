const express = require('express');
const router = express.Router();
const hocketLinkController = require('../controllers/HocketLinkController');
const { ensureAuthenticated } = require('../middleware/auth');
const { check, validationResult } = require('express-validator');
const HocketLink = require("../models/HocketLink")
// Middleware para validação do plano
const planCheck = require('../middleware/planCheck');


router.get('/dashboard', (req, res) => {
    res.render('hocketlink', {user: req.user});
  });

  
// Middleware de validação para criação/atualização de links
const validateLink = [
  check('customPath')
    .trim()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9-]+$/)
    .withMessage('Custom path must be between 3-50 characters and contain only lowercase letters, numbers, and hyphens'),
  
  check('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name is required and must be less than 100 characters'),
  
  check('numbers')
    .isArray({ min: 1 })
    .withMessage('At least one WhatsApp number is required')
    .custom((numbers) => {
      return numbers.every(num => /^\d{10,15}$/.test(num.replace(/\D/g, '')));
    })
    .withMessage('Invalid WhatsApp number format'),
  
  check('redirectType')
    .isIn(['random', 'rotative'])
    .withMessage('Invalid redirect type'),
  
  check('customMessage')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Custom message must be less than 1000 characters'),
  
  check('messageDelay')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Message delay must be between 0 and 10 seconds'),
  
  check('metaTags')
    .optional()
    .isObject()
    .withMessage('Meta tags must be an object'),
  
  check('metaTags.title')
    .optional()
    .isLength({ max: 60 })
    .withMessage('Meta title must be less than 60 characters'),
  
  check('metaTags.description')
    .optional()
    .isLength({ max: 160 })
    .withMessage('Meta description must be less than 160 characters'),
  
  check('metaTags.image')
    .optional()
    .isURL()
    .withMessage('Meta image must be a valid URL'),

  // Middleware para processar os erros de validação
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }
    next();
  }
];

// Rota para renderizar a página de gerenciamento de links
router.get('/manage', ensureAuthenticated, async (req, res) => {
  try {
    const links = await HocketLink.find({ user: req.user.id });
    res.render('hocket-links', { 
      user: req.user, 
      links: links,
      baseUrl: `${req.protocol}://${req.get('host')}/r/`
    });
  } catch (error) {
    res.status(500).render('error', { message: 'Error loading links' });
  }
});

// Rotas API
// Criar novo link
router.post('/',
  ensureAuthenticated,
  planCheck(['basic', 'plus', 'premium']), // Apenas planos pagos podem criar links
  validateLink,
  hocketLinkController.createLink
);

// Obter todos os links do usuário
router.get('/',
  ensureAuthenticated,
  hocketLinkController.getLinks
);

// Obter link específico
router.get('/:id',
  ensureAuthenticated,
  hocketLinkController.getLink
);

// Atualizar link
router.put('/:id',
  ensureAuthenticated,
  validateLink,
  hocketLinkController.updateLink
);

// Excluir link
router.delete('/:id',
  ensureAuthenticated,
  hocketLinkController.deleteLink
);

// Obter estatísticas do link
router.get('/:id/stats',
  ensureAuthenticated,
  hocketLinkController.getLinkStats
);

// Rota para buscar estatísticas gerais
router.get('/stats/overview', ensureAuthenticated, async (req, res) => {
  try {
    // Buscar todos os links do usuário
    const links = await HocketLink.find({ user: req.user.id });
    
    // Calcular estatísticas gerais
    const stats = {
      totalLinks: links.length,
      totalClicks: 0,
      topLinks: [],
      clicksByDay: {},
      recentClicks: []
    };

    // Processar cada link
    links.forEach(link => {
      // Somar cliques totais
      stats.totalClicks += link.stats.clicks;

      // Adicionar ao array de top links
      stats.topLinks.push({
        name: link.name,
        customPath: link.customPath,
        clicks: link.stats.clicks
      });

      // Processar histórico de redirecionamentos
      link.stats.redirectHistory.forEach(redirect => {
        const day = new Date(redirect.timestamp).toISOString().split('T')[0];
        stats.clicksByDay[day] = (stats.clicksByDay[day] || 0) + 1;

        // Adicionar aos cliques recentes
        stats.recentClicks.push({
          linkName: link.name,
          timestamp: redirect.timestamp,
          number: redirect.number
        });
      });
    });

    // Ordenar top links por cliques
    stats.topLinks.sort((a, b) => b.clicks - a.clicks);
    stats.topLinks = stats.topLinks.slice(0, 5); // Pegar apenas os top 5

    // Ordenar cliques recentes por data
    stats.recentClicks.sort((a, b) => b.timestamp - a.timestamp);
    stats.recentClicks = stats.recentClicks.slice(0, 10); // Últimos 10 cliques

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

// Rota para verificar disponibilidade de customPath
router.get('/check-path/:customPath', ensureAuthenticated, async (req, res) => {
  try {
    const { customPath } = req.params;
    const existingLink = await HocketLink.findOne({ customPath });
    
    res.json({
      success: true,
      available: !existingLink
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking path availability',
      error: error.message
    });
  }
});

module.exports = router;