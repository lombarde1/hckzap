const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');
const { ensureAuthenticated } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const API_BASE_URL = `https://api.hocketzap.com`
const axios = require("axios")
// Rate limiting para endpoints da API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100 // limite por IP
});

const funnelController = require('../controllers/funnelController'); // Adicione esta linha no topo do arquivo
const { executeFunnel } = require('../services/funnelExecutor');
const PLAN_LIMITS = require('../config/planLimits');

const limits = {
    gratuito: { daily: 0, monthly: 0 },
    
    // Plano Básico
    basico_monthly: { daily: 1000, monthly: 10000 },
    basico_quarterly: { daily: 1000, monthly: 10000 },
    basico_semiannual: { daily: 1000, monthly: 10000 },
    
    // Plano Plus
    plus_monthly: { daily: 5000, monthly: 50000 },
    plus_quarterly: { daily: 5000, monthly: 50000 },
    plus_semiannual: { daily: 5000, monthly: 50000 },
    
    // Plano Premium
    premium_monthly: { daily: Infinity, monthly: Infinity },
    premium_quarterly: { daily: Infinity, monthly: Infinity },
    premium_semiannual: { daily: Infinity, monthly: Infinity }
};


async function sendTextMessage(instance, content, delay, number) {
    const url = `${API_BASE_URL}/message/sendText/${instance}`;

    const data = JSON.stringify({
        number: number,
        text: content,
        // options
        delay: delay * 1000 || 1200,
        linkPreview: true
    });

    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': "darkadm"
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log('Mensagem de texto enviada:', JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Erro ao enviar mensagem de texto:', error);
        throw error;
    }
}

function getMimeType(mediaType) {
    switch (mediaType) {
        case 'image':
            return 'image/png'; // ou 'image/jpeg'
        case 'video':
            return 'video/mp4';
        case 'document':
            return 'application/pdf'; // ajuste conforme necessário
        default:
            return 'application/octet-stream';
    }
}


function getFileExtension(mediaType) {
    switch (mediaType) {
        case 'image':
            return 'png'; // ou 'jpg'
        case 'video':
            return 'mp4';
        case 'document':
            return 'pdf';
        default:
            return 'bin';
    }
}


async function sendMediaMessage(instanceKey, mediaUrl, number, mediaType, fileName, caption) {
    const url = `${API_BASE_URL}/message/sendMedia/${instanceKey}`;
    const data = JSON.stringify({
        number: number,
        mediatype: mediaType, // 'image', 'video', ou 'document'
        mimetype: getMimeType(mediaType),
        caption: caption,
        media: mediaUrl,
        fileName: fileName || `file.${getFileExtension(mediaType)}`
    });

    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': "darkadm"
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log('Mídia enviada:', JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Erro ao enviar mídia:', error);
        throw error;
    }
}


async function getApiLimits(user) {
   
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const userLimits = limits[user.plan] || limits.gratuito;

    // Verificar se o plano tem acesso à API
    if (!PLAN_LIMITS[user.plan]?.api) {
        throw new Error('Seu plano atual não permite acesso à API. Faça upgrade para utilizar esta funcionalidade.');
    }

    // Resetar contadores se necessário
    if (!user.apiUsage?.lastRequestDate || user.apiUsage.lastRequestDate < today) {
        user.apiUsage = {
            ...user.apiUsage,
            dailyRequests: 0,
            lastRequestDate: now
        };
    }

    if (!user.apiUsage?.lastRequestDate || 
        user.apiUsage.lastRequestDate.getMonth() !== now.getMonth()) {
        user.apiUsage.monthlyRequests = 0;
    }

    // Verificar limites antes de incrementar
      // Calcular remaining (restantes) antes de verificar limites
      const dailyRemaining = userLimits.daily === Infinity ? Infinity : Math.max(0, userLimits.daily - (user.apiUsage.dailyRequests || 0));
      const monthlyRemaining = userLimits.monthly === Infinity ? Infinity : Math.max(0, userLimits.monthly - (user.apiUsage.monthlyRequests || 0));

      
 // Verificar limites antes de incrementar
if (userLimits.daily !== Infinity && user.apiUsage?.dailyRequests >= userLimits.daily) {
    throw new Error(JSON.stringify({
        code: 'DAILY_LIMIT_EXCEEDED',
        message: `Limite diário de ${userLimits.daily} requisições atingido`,
        limit: {
            type: 'daily',
            max: userLimits.daily,
            current: user.apiUsage.dailyRequests
        }
    }));
}

if (userLimits.monthly !== Infinity && user.apiUsage?.monthlyRequests >= userLimits.monthly) {
    throw new Error(JSON.stringify({
        code: 'MONTHLY_LIMIT_EXCEEDED',
        message: `Limite mensal de ${userLimits.monthly} requisições atingido`,
        limit: {
            type: 'monthly',
            max: userLimits.monthly,
            current: user.apiUsage.monthlyRequests
        }
    }));
}

    // Incrementar contadores
    user.apiUsage = {
        ...user.apiUsage,
        dailyRequests: (user.apiUsage.dailyRequests || 0) + 1,
        monthlyRequests: (user.apiUsage.monthlyRequests || 0) + 1,
        lastRequestDate: now
    };
    user.lastApiRequest = now;

    await user.save();

    return {
        success: true,
        plan: user.plan,
        planStatus: {
            name: user.plan,
            hasApiAccess: PLAN_LIMITS[user.plan]?.api || false,
            validUntil: user.validUntil
        },
        limits: {
            daily: {
                limit: userLimits.daily === Infinity ? 'Unlimited' : userLimits.daily,
                remaining: dailyRemaining,
                used: user.apiUsage.dailyRequests
            },
            monthly: {
                limit: userLimits.monthly === Infinity ? 'Unlimited' : userLimits.monthly,
                remaining: monthlyRemaining,
                used: user.apiUsage.monthlyRequests
            }
        },
        usage: {
            lastRequest: now,
            todayRequests: user.apiUsage.dailyRequests,
            monthRequests: user.apiUsage.monthlyRequests
        }
    };
}

// Middleware para verificar API key
// Middleware para verificar API key
const verifyApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key não fornecida',
            docs: 'https://dev.hocketzap.com/api/docs'
        });
    }

    try {
        const user = await User.findOne({ apiKey });
        if (!user) {
            return res.status(401).json({ error: 'API key inválida' });
        }

        // Verificar e atualizar limites
        try {
            const apiLimits = await getApiLimits(user);
            req.apiUser = user;
            req.apiLimits = apiLimits;
            next();
        } catch (limitError) {
            // Retornar resposta específica para limites excedidos
            return res.status(429).json({
                success: false,
                error: limitError.message,
                limits: {
                    plan: user.plan,
                    planStatus: {
                        name: user.plan,
                        hasApiAccess: PLAN_LIMITS[user.plan]?.api || false,
                        validUntil: user.validUntil
                    },
                    usage: {
                        daily: {
                            limit: user.apiUsage?.dailyRequests || 0,
                            maxLimit: limits[user.plan]?.daily || 0
                        },
                        monthly: {
                            limit: user.apiUsage?.monthlyRequests || 0,
                            maxLimit: limits[user.plan]?.monthly || 0
                        },
                        lastRequest: user.apiUsage?.lastRequestDate
                    }
                },
                retryAfter: {
                    seconds: calculateRetryAfter(user.apiUsage?.lastRequestDate),
                    message: "Tente novamente após este período"
                }
            });
        }
    } catch (error) {
        console.error('Erro na verificação da API key:', error);
        return res.status(500).json({ 
            success: false,
            error: 'Erro interno ao validar API key',
            message: error.message
        });
    }
};

// Função auxiliar para calcular tempo de espera
function calculateRetryAfter(lastRequestDate) {
    if (!lastRequestDate) return 24 * 60 * 60; // 24 horas em segundos

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return Math.ceil((tomorrow - now) / 1000);
}


// Rotas da documentação e gerenciamento de API key
router.get('/docs', ensureAuthenticated, apiController.renderApiDocs);
router.post('/generate-key', ensureAuthenticated, apiController.generateApiKey);
router.post('/revoke-key', ensureAuthenticated, apiController.revokeApiKey);
router.get('/test-connection', verifyApiKey, apiController.testApiConnection);
router.get('/usage', ensureAuthenticated, apiController.getApiUsage);

// Endpoints da API (com rate limiting e verificação de API key)
router.use('/v2', apiLimiter, verifyApiKey);

// Endpoint para envio de mensagens
router.post('/v2/message/send-text', async (req, res) => {
    try {
        const { instanceKey, number, message } = req.body;
        
        if (!instanceKey || !number || !message) {
            return res.status(400).json({ 
                error: 'Parâmetros obrigatórios não fornecidos' 
            });
        }

        // Usar a função existente do funnelExecutor
        const result = await sendTextMessage(instanceKey, message, 1, number);
        res.json({"success": true, id: result.messageTimestamp,  limits: req.apiLimits})
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para envio de mídia
router.post('/v2/message/send-media', async (req, res) => {
    try {
        const { instanceKey, number, mediaUrl, type, caption } = req.body;
        
        if (!instanceKey || !number || !mediaUrl || !type) {
            return res.status(400).json({ 
                error: 'Parâmetros obrigatórios não fornecidos' 
            });
        }

        // Usar função existente do funnelExecutor
        const result = await sendMediaMessage(
            instanceKey, 
            mediaUrl, 
            number, 
            type, 
            `file.${type === 'image' ? 'jpg' : 'mp4'}`,
            caption || ''
        );
        
      //  res.json(result);
      res.json({"success": true, id: result.messageTimestamp, limits: req.apiLimits})
    } catch (error) {
        console.error('Erro ao enviar mídia:', error);
        res.status(500).json({ error: error.message });
    }
});


// Endpoint para executar funil
const redisClient = require('../config/redisConfig');
const AUTO_RESPONSE_EXPIRY = 60 * 60 * 24; // 24 horas em segundos

router.post('/v2/funnel/execute', async (req, res) => {
    try {
        const { funnelId, instanceKey, chatId } = req.body;
        
        if (!funnelId || !instanceKey || !chatId) {
            return res.status(400).json({ 
                error: 'Parâmetros obrigatórios não fornecidos' 
            });
        }

        const iddochat = `${chatId}@s.whatsapp.net`
        const user = req.apiUser;
    // Buscar o funil do Redis
    const funnel = await funnelController.getFunnelById(funnelId, user.id);

    if (!funnel) {
      return res.status(404).json({ error: 'Funil não encontrado' });
    }

    const autoResponseKey = `auto_response:${instanceKey}:${iddochat}`;
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
    executeFunnel(funnel, iddochat, instanceKey, state);

    res.json({ message: 'Funil iniciado com sucesso', currentNodeId: state.currentNodeId });

    } catch (error) {
        console.error('Erro ao executar funil:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;