const redisClient = require('../config/redisConfig');
const { executeFunnel, sendTextMessage } = require('../services/funnelExecutor');
const colors = require('colors');
const AUTO_RESPONSE_EXPIRY = 60 * 60; // 1 hora em segundos
const PLAN_LIMITS = require('../config/planLimits');
const User = require('../models/User');
const DailyUsage = require('../models/DailyUsage');
const { updateDailyUsage } = require('../Helpers/usageHelper');

// Atualiza campanhas de autoresposta
exports.updateCampaigns = async (req, res) => {
    try {
        const { instanceKey, campaigns } = req.body;
        const campaignsKey = `auto_response_campaigns:${instanceKey}`;

        // Validar se todas as campanhas têm um funnelId
        const validCampaigns = campaigns.filter(campaign => campaign.funnelId);
        
        if (validCampaigns.length !== campaigns.length) {
            console.warn(`Algumas campanhas não têm funnelId. Total: ${campaigns.length}, Válidas: ${validCampaigns.length}`);
        }

        await redisClient.set(campaignsKey, JSON.stringify(validCampaigns));

        res.json({ success: true, message: 'Campanhas de autoresposta atualizadas com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar campanhas:', error);
        res.status(500).json({ error: 'Erro ao atualizar campanhas de autoresposta' });
    }
};
// Obtém campanhas de autoresposta
exports.getCampaigns = async (req, res) => {
    const { instanceKey } = req.params;
    const campaignsKey = `auto_response_campaigns:${instanceKey}`;

    try {
        const campaignsData = await redisClient.get(campaignsKey);
        const campaigns = campaignsData ? JSON.parse(campaignsData) : [];
        return res.json({ success: true, campaigns });
    } catch (error) {
        console.error('Erro ao buscar campanhas:', error);
        return res.status(500).json({ error: 'Erro ao buscar campanhas de autoresposta' });
    }
};


async function saveLastMessage(instanceKey, chatId, message) {
    const key = `last_message:${instanceKey}:${chatId}`;
    await redisClient.set(key, message);
    await redisClient.expire(key, AUTO_RESPONSE_EXPIRY);
}

async function saveAutoResponseMessage(instanceKey, chatId, content, type = 'text') {
    const messageKey = `${chatId}:${Date.now()}`;
    const messageData = {
        key: messageKey,
        sender: 'Auto-resposta',
        content: content,
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: true,
        type: type
    };

    await saveMessage(instanceKey, chatId, messageData);
}

// Processa autoresposta com base na campanha
exports.handleAutoResponse = async (instanceKey, chatId, message, source) => {
    try {
        console.log('Processando autoresposta para:'.cyan, { instanceKey, chatId, message });
        
        const user = await User.findOne({ 'whatsappInstances.name': instanceKey });
        if (!user) {
          console.error('Usuário não encontrado para a instância:', instanceKey);
          return;
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
    
        let dailyUsage = await DailyUsage.findOne({ userId: user._id, date: today });
        if (!dailyUsage) {
          dailyUsage = new DailyUsage({ userId: user._id, date: today });
        }
    
        const dailyLimit = PLAN_LIMITS[user.plan].dailyAutoResponses;
    
        if (dailyUsage.autoResponses >= dailyLimit) {
          console.log('Limite diário de autorespostas atingido para o usuário:', user._id);
          return;
        }

        const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
        const currentState = await redisClient.get(`auto_response:${instanceKey}:${chatId}`);
        await saveLastMessage(instanceKey, chatId, message);

        

        if (currentState) {
            let state = JSON.parse(currentState);
            console.log('Estado atual:'.yellow, JSON.stringify(state.status, null, 2));
            
            if (state.status === 'waiting_for_input') {
                state.userInputs[state.expectedInput] = message;
                state.status = 'in_progress';
                
                console.log('Estado atualizado após input:'.green, JSON.stringify(state, null, 2));

                const funnel = await getFunnelFromRedis(state.funnelId);
                if (funnel) {
                    // Encontrar o próximo nó após o input
                    const currentNode = funnel.nodes.find(node => node.id === state.currentNodeId);
                    const nextConnection = funnel.connections.find(conn => conn.sourceId === currentNode.id);
                    state.currentNodeId = nextConnection ? nextConnection.targetId : null;

                    await redisClient.setex(autoResponseKey, AUTO_RESPONSE_EXPIRY, JSON.stringify(state));
                    await executeFunnel(funnel, chatId, instanceKey, state);
                } else {
                    console.error('Funil não encontrado:'.red, state.funnelId);
                }
                return;
            }
        }

        // Se não estiver em um estado de espera, processa como uma nova autoresposta
        const campaignsKey = `auto_response_campaigns:${instanceKey}`;
        const campaignsData = await redisClient.get(campaignsKey);
        const campaigns = campaignsData ? JSON.parse(campaignsData) : [];

        let campaignExecuted = false;

        console.log('Campanhas carregadas:', campaigns);

        for (const campaign of campaigns) {
            console.log('Verificando campanha:', campaign.name);
            console.log('Condição:', campaign.condition);
            console.log('Valor:', campaign.value);
            console.log('Mensagem recebida:', message);
            if (campaign.isActive && shouldExecuteCampaign(campaign, message)) {
                console.log('Campanha correspondente encontrada:', campaign.name);
                try {
                    await updateDailyUsage(user._id, 'autoResponses', 1);
                    console.log(`Executando campanha:`.green, campaign.name);
                    await executeCampaign(instanceKey, chatId, message, campaign);
                    campaignExecuted = true;
                  } catch (error) {
                    console.error('Erro ao atualizar uso diário ou executar campanha:', error);
                  }
                break;
            }
        }

        console.log('Nenhuma campanha correspondente encontrada'.yellow);

        if (campaignExecuted) {
            if (source !== "webhook") {
                console.log('Chamada de autoresposta ignorada, não é proveniente de webhook'.yellow);
                return;
            }

            // Incrementar apenas se uma campanha foi executada
          
            console.log(`Uso de autoresposta incrementado para o usuário ${user._id}`.green);
        } else {
            console.log('Nenhuma campanha correspondente encontrada'.yellow);
        }


    } catch (error) {
        console.error('Erro ao processar autoresposta:'.red, error);
    }
};

// Processa estado atual da autoresposta
async function processCurrentState(autoResponseKey, chatId, instanceKey, currentState, message) {
    const state = JSON.parse(currentState);
    if (state.status === 'waiting_for_input') {
        state.userInputs[state.expectedInput] = message;
        state.status = 'in_progress';
        await redisClient.setex(autoResponseKey, AUTO_RESPONSE_EXPIRY, JSON.stringify(state));
        
        const funnel = await getFunnelFromRedis(state.funnelId);
        if (funnel) {
            await executeFunnel(funnel, chatId, instanceKey, state);
        }
    }
}

async function getFunnelFromRedis(funnelId) {
    const funnelKey = `funnel:${funnelId}`;
    const funnelData = await redisClient.get(funnelKey);
    if (!funnelData) {
        console.error(`Funil não encontrado no Redis: ${funnelId}`);
        return null;
    }
    return JSON.parse(funnelData);
}

// Verifica se a campanha deve ser executada
function shouldExecuteCampaign(campaign, message) {
    const lowerCaseMessage = message.toLowerCase();
    switch (campaign.condition) {
        case 'all':
            return true;
        case 'startsWith':
            return lowerCaseMessage.startsWith(campaign.value.toLowerCase());
        case 'contains':
            return lowerCaseMessage.includes(campaign.value.toLowerCase());
        case 'equals':
            return lowerCaseMessage === campaign.value.toLowerCase();
        case 'regex':
            return new RegExp(campaign.value, 'i').test(lowerCaseMessage);
        default:
            return false;
    }
}

// Registra a ativação da campanha
async function recordCampaignActivation(instanceKey, campaignName, chatId) {
    const activationsKey = `campaign_activations:${instanceKey}:${campaignName}`;
    const reportsKey = `auto_response_reports:${instanceKey}`;
    const userUsageKey = `user_auto_response_usage:${instanceKey}`;

    try {
        await Promise.all([
            redisClient.incr(activationsKey),
            redisClient.incr(userUsageKey),
            redisClient.lpush(reportsKey, JSON.stringify({
                campaignName,
                chatId,
                timestamp: new Date().toISOString(),
            })),
            redisClient.ltrim(reportsKey, 0, 99)
        ]);

        console.log(`Ativação de campanha registrada: ${campaignName}`.green);
        console.log(`Uso de autoresposta incrementado para a instância: ${instanceKey}`.green);
    } catch (error) {
        console.error('Erro ao registrar ativação de campanha:', error);
    }
}

async function checkCampaignsIntegrity(instanceKey) {
    const campaignsKey = `auto_response_campaigns:${instanceKey}`;
    const campaignsData = await redisClient.get(campaignsKey);
    const campaigns = campaignsData ? JSON.parse(campaignsData) : [];

    const validCampaigns = campaigns.filter(campaign => campaign.funnelId);
    
    if (validCampaigns.length !== campaigns.length) {
        console.warn(`Campanhas inválidas encontradas para a instância ${instanceKey}. Total: ${campaigns.length}, Válidas: ${validCampaigns.length}`);
        await redisClient.set(campaignsKey, JSON.stringify(validCampaigns));
    }
}


async function executeCampaign(instanceKey, chatId, message, campaign) {
    const funnel = await getFunnelFromRedis(campaign.funnelId);
    if (!funnel) {
        console.error('Funil não encontrado:'.red, campaign.funnelId);
        return;
    }

    console.log(`Iniciando execução do funil:`.green, funnel.name);


     // Registra a ativação da campanha
     await recordCampaignActivation(instanceKey, campaign.name, chatId);

    const initialState = {
        funnelId: funnel.id,
        currentNodeId: funnel.nodes[0].id,
        status: 'in_progress',
        userInputs: {},
        lastMessage: message
    };

    const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
    await redisClient.setex(autoResponseKey, AUTO_RESPONSE_EXPIRY, JSON.stringify(initialState));

    await executeFunnel(funnel, chatId, instanceKey, initialState);
}

// Relatório de autoresposta
exports.getAutoResponseReport = async (req, res) => {
    const { instanceKey } = req.params;
    const reportsKey = `auto_response_reports:${instanceKey}`;
    const campaignsKey = `auto_response_campaigns:${instanceKey}`;
    const userUsageKey = `user_auto_response_usage:${instanceKey}`;

    try {
        const [reportsData, campaignsData, totalUsage] = await Promise.all([
            redisClient.lrange(reportsKey, 0, 9),
            redisClient.get(campaignsKey),
            redisClient.get(userUsageKey),
        ]);

        const recentResponses = reportsData.map((report) => {
            const { campaignName, chatId, timestamp } = JSON.parse(report);
            return {
                campaignName,
                phoneNumber: chatId.split('@')[0],
                timestamp,
            };
        });

        const campaigns = JSON.parse(campaignsData || '[]');
        const campaignActivations = {};

        await Promise.all(
            campaigns.map(async (campaign) => {
                const activationsKey = `campaign_activations:${instanceKey}:${campaign.name}`;
                const count = await redisClient.get(activationsKey);
                campaignActivations[campaign.name] = parseInt(count || '0');
            })
        );

        res.json({
            success: true,
            totalResponses: parseInt(totalUsage || '0'),
            recentResponses,
            campaignActivations,
        });
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).json({ success: false, error: 'Erro ao gerar relatório' });
    }
};

// Uso de autoresposta por usuário



exports.getAutoResponseUsage = async (req, res) => {
    const { instanceKey } = req.params;
    const userId = req.user.id;

    try {
        const user = await User.findById(userId).select('plan');
        if (!user) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let dailyUsage = await DailyUsage.findOne({ userId: userId, date: today });
        if (!dailyUsage) {
            dailyUsage = new DailyUsage({ userId: userId, date: today, autoResponses: 0 });
            await dailyUsage.save();
        }

        const isPremium = user.plan === 'premium';
        const limit = PLAN_LIMITS[user.plan].dailyAutoResponses;
        const usage = dailyUsage.autoResponses || 0;

        res.json({
            success: true,
            usage,
            limit: isPremium ? Infinity : limit,
            isPremium,
        });
    } catch (error) {
        console.error('Erro ao obter uso de autoresposta:', error);
        res.status(500).json({ success: false, error: 'Erro ao obter uso de autoresposta' });
    }
};

// Inicia nova autoresposta
exports.startNewAutoResponse = async (instanceKey, chatId, initialMessage) => {
    console.log('Iniciando nova autoresposta:'.cyan, { instanceKey, chatId, initialMessage });

    const instanceData = await redisClient.hgetall(`instance:${instanceKey}`);
    
    if (!instanceData || !instanceData.autoResponseActive || !instanceData.autoResponseFunnelId) {
        return console.log('Autoresposta não está ativa para esta instância'.yellow);
    }

    const funnel = await getFunnelFromRedis(instanceData.autoResponseFunnelId);
    if (!funnel) {
        return console.error('Funil não encontrado:', instanceData.autoResponseFunnelId);
    }

    const initialState = {
        funnelId: funnel.id,
        currentNodeId: funnel.nodes[0].id,
        status: 'in_progress',
        userInputs: {},
        lastMessage: initialMessage,
    };

    await redisClient.setex(`auto_response:${instanceKey}:${chatId}`, AUTO_RESPONSE_EXPIRY, JSON.stringify(initialState));
    await executeFunnel(funnel, chatId, instanceKey, initialState);
};

exports.toggleAutoResponse = async (req, res) => {
    try {
      const { instanceKey, funnelId, isActive } = req.body;
      const user = await User.findById(req.user.id);
  
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
  
      const instance = user.whatsappInstances.find(inst => inst.key === instanceKey);
      if (!instance) {
        return res.status(404).json({ error: 'Instância não encontrada' });
      }
  
      // Verifica se o funnelId é válido
      if (isActive && !mongoose.Types.ObjectId.isValid(funnelId)) {
        return res.status(400).json({ error: 'ID do funil inválido' });
      }
  
      instance.autoResponse = {
        isActive,
        funnelId: isActive ? new mongoose.Types.ObjectId(funnelId) : null
      };
  
      await user.save();
  
      res.json({ success: true, message: 'Configuração de autoresposta atualizada' });
    } catch (error) {
      console.error('Erro ao configurar autoresposta:', error);
      res.status(500).json({ error: 'Erro ao configurar autoresposta' });
    }
  };