// routes/webhookTester.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const axios = require('axios');

router.get('/', ensureAuthenticated, (req, res) => {
  res.render('webhook-tester', {
    user: req.user,
    instances: req.user.whatsappInstances || []
  });
});

router.post('/simulate', ensureAuthenticated, async (req, res) => {
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
          remoteJid: "5517991134416@s.whatsapp.net",
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

module.exports = router;