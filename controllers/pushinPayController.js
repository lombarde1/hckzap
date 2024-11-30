// controllers/pushinPayController.js
const PushinPayConfig = require('../models/PushinPayConfig');
const axios = require('axios');
const crypto = require('crypto');

exports.getPushinPayStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const config = await PushinPayConfig.findOne({ user: req.user.id });
    
    res.json({
      configured: !!config,
      active: config?.isActive || false,
      apiToken: config?.apiToken ? `${config.apiToken.substring(0, 6)}...` : null,
      webhookUrl: config?.webhookUrl
    });
  } catch (error) {
    console.error('Erro ao verificar status do PushinPay:', error);
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
};

exports.configurePushinPay = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { apiToken } = req.body;

    if (!apiToken) {
      return res.status(400).json({ error: 'Token da API é obrigatório' });
    }

    // Testa o token fazendo uma requisição de teste
    try {
      const response = await axios.post('https://api.pushinpay.com.br/api/pix/cashIn', 
        {
          value: 100, // Valor de teste: R$ 1,00
          webhook_url: `${process.env.BASE_URL || 'https://dev.hocketzap.com'}/pushinpay/webhook/${crypto.randomBytes(32).toString('hex')}`
        },
        {
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.data) {
        throw new Error('Erro na validação do token');
      }
    } catch (error) {
      console.error('Erro ao validar token PushinPay:', error);
      return res.status(400).json({ error: 'Token inválido ou erro na API do PushinPay' });
    }

    let config = await PushinPayConfig.findOne({ user: req.user.id });

    if (!config) {
      config = new PushinPayConfig({
        user: req.user.id,
        apiToken,
        webhookUrl: `${process.env.BASE_URL || 'https://dev.hocketzap.com'}/pushinpay/webhook/${crypto.randomBytes(32).toString('hex')}`,
        isActive: true
      });
    } else {
      config.apiToken = apiToken;
      config.isActive = true;
    }

    await config.save();

    res.json({
      success: true,
      message: 'Configuração do PushinPay salva com sucesso',
      webhookUrl: config.webhookUrl
    });
  } catch (error) {
    console.error('Erro ao configurar PushinPay:', error);
    res.status(500).json({ error: 'Erro ao salvar configuração' });
  }
};

exports.generatePixPayment = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { value } = req.body;

    if (!value || value <= 0) {
      return res.status(400).json({ error: 'Valor inválido' });
    }

    const config = await PushinPayConfig.findOne({ user: req.user.id });
    if (!config || !config.apiToken) {
      return res.status(400).json({ error: 'PushinPay não configurado' });
    }

    const response = await axios.post('https://api.pushinpay.com.br/api/pix/cashIn',
      {
        value: Math.round(value * 100), // Converte para centavos
        webhook_url: config.webhookUrl
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      success: true,
      pixCode: response.data.qr_code,
      qrCodeImage: response.data.qr_code_base64
    });
  } catch (error) {
    console.error('Erro ao gerar pagamento PIX:', error);
    res.status(500).json({ error: 'Erro ao gerar pagamento PIX' });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const { token } = req.params;
    const config = await PushinPayConfig.findOne({ webhookUrl: new RegExp(token) });
    
    if (!config) {
      console.error('Webhook não encontrado:', token);
      return res.status(404).json({ error: 'Webhook não encontrado' });
    }

    const payload = req.body;
    
    // Aqui você pode implementar a lógica para processar diferentes tipos de eventos
    // Por exemplo: pagamento confirmado, pagamento pendente, etc.
    console.log('Webhook PushinPay recebido:', payload);

    // Atualiza o timestamp do último webhook recebido
    config.lastWebhookReceived = new Date();
    await config.save();

    res.json({ success: true, message: 'Webhook processado com sucesso' });
  } catch (error) {
    console.error('Erro ao processar webhook PushinPay:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
};