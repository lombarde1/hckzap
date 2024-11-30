const CartpandaConfig = require('../models/CartPandaConfig');
const User = require('../models/User');
const Funnel = require('../models/Funnel');
const crypto = require('crypto');
const axios = require('axios');

const generateWebhookToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

exports.getCartpandaStatus = async (req, res) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }
  
      const config = await CartpandaConfig.findOne({ user: req.user.id });
      
      res.json({
        configured: !!config,
        active: config?.isActive || false,
        webhookUrl: config?.webhookUrl,
        events: config?.events || [],
        instanceKey: config?.instanceKey
      });
    } catch (error) {
      console.error('Erro ao verificar status do Cartpanda:', error);
      res.status(500).json({ error: 'Erro ao verificar status' });
    }
  };
exports.getFunnels = async (req, res) => {
  try {
    const funnels = await Funnel.find({ user: req.user.id }).select('_id name description');
    res.json(funnels);
  } catch (error) {
    console.error('Erro ao buscar funis:', error);
    res.status(500).json({ error: 'Erro ao buscar funis' });
  }
};
//
exports.configureCartpanda = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const { instanceKey, webhookToken, webhookUrl } = req.body;

    if (!instanceKey || !webhookToken || !webhookUrl) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }

    let config = await CartpandaConfig.findOne({ user: req.user.id });

    if (!config) {
      config = new CartpandaConfig({
        user: req.user.id,
        webhookToken, // Importante: Salvar o token gerado pelo frontend
        webhookUrl,
        instanceKey,
        isActive: true // Adicione isso para indicar que está ativo
      });
    } else {
      config.webhookToken = webhookToken;
      config.webhookUrl = webhookUrl;
      config.instanceKey = instanceKey;
      config.isActive = true;
    }

    await config.save();
    console.log('Configuração salva com webhook token:', webhookToken); // Log para debug
    
    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Erro ao configurar Cartpanda:', error);
    res.status(500).json({ error: 'Erro ao configurar integração' });
  }
};

exports.updateEventConfig = async (req, res) => {
  try {
    const { eventType, funnelId, isActive, delay } = req.body;
    
    const config = await CartpandaConfig.findOne({ user: req.user.id });
    if (!config) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    const eventIndex = config.events.findIndex(e => e.eventType === eventType);
    if (eventIndex === -1) {
      config.events.push({ eventType, funnelId, isActive, delay });
    } else {
      config.events[eventIndex] = { eventType, funnelId, isActive, delay };
    }

    await config.save();
    res.json({ success: true, config });
  } catch (error) {
    console.error('Erro ao atualizar evento:', error);
    res.status(500).json({ error: 'Erro ao atualizar evento' });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const { webhookToken } = req.params;
    const webhookUrl = `https://dev.hocketzap.com/cartpanda/webhook/${webhookToken}`;
    
    // Buscar configuração
    const config = await findAndValidateConfig(webhookUrl);
    if (!config.success) {
      return res.status(404).json(config.error);
    }

    // Processar dados do webhook
    const { eventType, customerPhone, orderData } = processWebhookData(req.body);
    if (!eventType) {
      return res.status(200).json({ message: 'Evento ignorado' });
    }

    if (!customerPhone) {
      return res.status(400).json({ error: 'Telefone do cliente não encontrado' });
    }

    // Processar evento
    const result = await processEvent(config.data, eventType, customerPhone);
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    // Atualizar último acesso
    await updateLastAccess(config.data);

    return res.json({ 
      success: true,
      message: 'Webhook processado com sucesso',
      eventType,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    return res.status(200).json({ 
      success: false,
      error: 'Erro ao processar webhook',
      message: error.message 
    });
  }
};

// Funções auxiliares
async function findAndValidateConfig(webhookUrl) {
  const config = await CartpandaConfig.findOne({ webhookUrl });
  
  if (!config) {
    console.error('Webhook não encontrado para a URL:', webhookUrl);
    return {
      success: false,
      error: { error: 'Webhook não encontrado' }
    };
  }

  return {
    success: true,
    data: config
  };
}

function processWebhookData(webhookData) {
  // Mapear tipo de evento
  const eventTypeMap = {
    'order.created': 'order_created',
    'abandoned.created': 'abandoned_cart',
    'payment.pix_generated': 'pix_generated',
    'order.paid': 'payment_confirmed'
  };

  const eventType = eventTypeMap[webhookData.event];
  if (!eventType) {
    console.log('Evento não mapeado:', webhookData.event);
    return { eventType: null };
  }

  // Processar dados do pedido
  if (!webhookData.order) {
    return { eventType };
  }

  const { order } = webhookData;
  const customerPhone = order.phone?.replace(/\D/g, '');

  const orderData = {
    orderNumber: order.order_number,
    customerName: order.customer?.full_name || 'Cliente',
    total: `R$ ${Number(order.total_price).toFixed(2)}`,
    products: order.line_items?.map(item => item.name).join(', ') || '',
    customerEmail: order.email,
    paymentType: order.payment_type,
    pixCode: order.pix_code,
    pixQrCode: order.pix_qr,
    pixDueDate: order.pix_limit_date
  };

  return { eventType, customerPhone, orderData };
}

async function processEvent(config, eventType, customerPhone) {
  const event = config.events.find(e => e.eventType === eventType);
  console.log('Evento encontrado:', event);

  if (!event?.isActive || !event?.funnelId) {
    console.log('Evento não configurado ou inativo:', eventType);
    return { success: true };
  }

  // Buscar usuário
  const user = await User.findById(config.user);
  if (!user) {
    console.error('Usuário não encontrado:', config.user);
    return {
      success: false,
      status: 404,
      error: 'Usuário não encontrado'
    };
  }

  // Buscar ID real do funil
  const funnelId = await getFunnelIdFromName(user.id, event.funnelId);
  if (!funnelId) {
    return {
      success: false,
      error: 'Funil não encontrado'
    };
  }

  // Validar instância do WhatsApp
  if (!config.instanceKey) {
    return {
      success: false,
      error: 'Nenhuma instância do WhatsApp configurada'
    };
  }

  // Executar funil
  try {
    if (event.delay > 0) {
      console.log(`Agendando início do funil com delay de ${event.delay} segundos`);
      setTimeout(() => startFunnel(config.instanceKey, customerPhone, funnelId), event.delay * 1000);
    } else {
      console.log('Iniciando funil imediatamente');
      await startFunnel(config.instanceKey, customerPhone, funnelId);
    }
    return { success: true };
  } catch (error) {
    console.error('Erro ao iniciar funil:', error);
    return { success: true }; // Retorna sucesso mesmo com erro para evitar reenvios
  }
}

async function getFunnelIdFromName(userId, funnelName) {
  const funnelsKey = `user:${userId}:funnels`;
  const funnelIds = await redisClient.smembers(funnelsKey);

  const funnels = await Promise.all(funnelIds.map(async (funnelId) => {
    const funnelData = await redisClient.get(`funnel:${funnelId}`);
    return JSON.parse(funnelData);
  }));

  const funnel = funnels.find(f => f.name === funnelName);
  return funnel?.id;
}

async function updateLastAccess(config) {
  config.lastWebhookReceived = new Date();
  await config.save();
}
  
  const AUTO_RESPONSE_EXPIRY = 60 * 60; // 1 hora em segundos
  const { executeFunnel } = require('../services/funnelExecutor');
const redisClient = require('../config/redisConfig');
const funnelController = require('../controllers/funnelController'); // Adicione esta linha no topo do arquivo

  async function startFunnel(instanceKey, chatId, funnelId, iduser) {
    try {
   
      const user = await User.findOne({ 'whatsappInstances.name': instanceKey });
      if (!user) {
       console.log('Instância não encontrada')
      }
  
      // Buscar o funil do Redis
      const funnel = await funnelController.getFunnelById(funnelId, user._id);
  
      if (!funnel) {
        console.log('Funil não encontrado')
      }
  
      const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
      let state = await redisClient.get(autoResponseKey);
  
      if (state) {
        state = JSON.parse(state);
        if (state.funnelId !== funnelId) {
          state = null;
        }
      }
  
      if (!state) {
        state = {
          funnelId: funnelId,
          currentNodeId: funnel.nodes[0].id, // Assumindo que o primeiro nó é o inicial
          status: 'in_progress',
          userInputs: {},
          lastMessage: ''
        };
      }
  
      await redisClient.setex(
        autoResponseKey,
        AUTO_RESPONSE_EXPIRY,
        JSON.stringify(state)
      );
  
      // Iniciar a execução do funil
      executeFunnel(funnel, chatId, instanceKey, state);
  
      console.log("Funil iniciado")
    } catch (error) {
      console.error('Erro ao iniciar funil:', error);
   
    }
  }
  
  // Função auxiliar para formatar número de telefone
  function formatPhoneNumber(phone) {
    // Remove todos os caracteres não numéricos
    const cleaned = phone.replace(/\D/g, '');
  
    // Verifica se começa com +55 ou 55, se não, adiciona
    const withCountryCode = cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
  
    // Verifica se o número tem o tamanho correto
    if (withCountryCode.length < 12 || withCountryCode.length > 13) {
      return null;
    }
  
    return withCountryCode;
  }