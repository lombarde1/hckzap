// routes/whatsappCampaign.js
const express = require('express');
const router = express.Router();
const WhatsappCampaign = require('../models/WhatsappCampaign');
const { ensureAuthenticated } = require('../middleware/auth');
const statsController = require('../controllers/statsController');
router.get('/:id/stats', ensureAuthenticated, statsController.getStats);
router.post('/:id/stats', ensureAuthenticated, statsController.updateStats);
const multiPlanCheck = require('../middleware/multiPlanCheck');

// Criar nova campanha
router.get('/webhook-tester', ensureAuthenticated, (req, res) => {
  res.render('webhook-tester', {
    user: req.user,
    instances: req.user.whatsappInstances || []
  });
});

router.post('/webhook-tester/simulate', ensureAuthenticated, async (req, res) => {
  try {
    const {
      instanceKey,
      messageType = 'conversation',
      message,
      mediaUrl = ''
    } = req.body;

    // Simular estrutura do webhook do WhatsApp
    const webhookData = {
      event: 'messages.upsert',
      instance: instanceKey,
      data: {
        key: {
          remoteJid: "5517991134416@s.whatsrouter.net",
          fromMe: false,
          id: `TEST${Date.now()}`
        },
        pushName: "Test User",
        messageTimestamp: Math.floor(Date.now() / 1000),
        messageType: messageType,
        message: {
          conversation: message
        }
      }
    };

    // Adicionar dados específicos para mensagens de mídia
    if (messageType !== 'conversation' && mediaUrl) {
      webhookData.data.message = {
        [messageType]: {
          url: mediaUrl,
          caption: message
        }
      };
    }

    // Enviar webhook para o endpoint local
    const response = await axios.post('https://dev.hocketzap.com/webhook/evolution', webhookData);

    res.json({
      success: true,
      message: 'Webhook simulado com sucesso',
      webhookResponse: response.data
    });

  } catch (error) {
    console.error('Erro ao simular webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/general-stats', ensureAuthenticated, async (req, res) => {
    try {
      // Obter todas as campanhas do usuário
      const campaigns = await WhatsappCampaign.find({ user: req.user._id });
  
      // Calcular estatísticas de campanhas
      const campaignStats = campaigns.map(campaign => ({
        name: campaign.name,
        clicks: campaign.stats.clicks
      })).sort((a, b) => b.clicks - a.clicks).slice(0, 5); // Top 5 campanhas
  
      // Calcular estatísticas de números
      const numberStats = {};
      campaigns.forEach(campaign => {
        campaign.numbers.forEach(number => {
          if (numberStats[number]) {
            numberStats[number] += campaign.stats.clicks;
          } else {
            numberStats[number] = campaign.stats.clicks;
          }
        });
      });
  
      const topNumbers = Object.entries(numberStats)
        .map(([number, activations]) => ({ number, activations }))
        .sort((a, b) => b.activations - a.activations)
        .slice(0, 5); // Top 5 números
  
      res.json({
        campaigns: campaignStats,
        numbers: topNumbers
      });
    } catch (error) {
      console.error('Erro ao obter estatísticas gerais:', error);
      res.status(500).json({ message: 'Erro ao obter estatísticas gerais' });
    }
  });
  
router.post('/', ensureAuthenticated, async (req, res) => {
    try {
      const { name, customPath, numbers, redirectType, messageDelay, customMessage } = req.body;
      const campaign = new WhatsappCampaign({
        name,
        customPath,
        numbers,
        redirectType,
        messageDelay,
        customMessage,
        user: req.user._id
      });
      await campaign.save();
      res.status(201).json(campaign);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  router.get('/:id/stats', ensureAuthenticated, async (req, res) => {
    try {
      const campaign = await WhatsappCampaign.findOne({ _id: req.params.id, user: req.user._id });
      if (!campaign) return res.status(404).json({ message: 'Campanha não encontrada' });
      res.json(campaign.stats);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

const metaTagController = require('../controllers/metaTagController');
router.post('/:campaignId/meta-tags', ensureAuthenticated, metaTagController.generateMetaTags);

router.get('/manage', ensureAuthenticated, async (req, res) => {
    try {
      const campaigns = await WhatsappCampaign.find({ user: req.user._id });
      res.render('whatsappCampaigns', { 
        user: req.user, 
        campaigns: campaigns,
        baseUrl: `${req.protocol}://${req.get('host')}/r/`
      });
    } catch (error) {
      res.status(500).render('error', { message: 'Erro ao carregar campanhas' });
    }
  });

  
// Obter todas as campanhas do usuário
router.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const campaigns = await WhatsappCampaign.find({ user: req.user._id });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Atualizar campanha
router.put('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const { name, customPath, numbers } = req.body;
    const campaign = await WhatsappCampaign.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { name, customPath, numbers, updatedAt: Date.now() },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ message: 'Campanha não encontrada' });
    res.json(campaign);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Excluir campanha
router.delete('/:id', ensureAuthenticated, async (req, res) => {
  try {
    const campaign = await WhatsappCampaign.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!campaign) return res.status(404).json({ message: 'Campanha não encontrada' });
    res.json({ message: 'Campanha excluída com sucesso' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;