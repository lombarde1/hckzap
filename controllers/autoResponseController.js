const redisClient = require('../config/redisConfig');
const { executeFunnel, sendTextMessage } = require('../services/funnelExecutor');
const colors = require('colors');
const AUTO_RESPONSE_EXPIRY = 60 * 60 * 24 * 7; // 1 hora em segundos
const PLAN_LIMITS = require('../config/planLimits');
const User = require('../models/User');
const DailyUsage = require('../models/DailyUsage');
const { updateDailyUsage } = require('../Helpers/usageHelper');
const { logUserActivity, ActivityTypes } = require('../Helpers/activityHistoryHelpers');
const LimitsService = require('../services/limitsService');

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

// Em autoResponseController.js

exports.handleButtonResponse = async (instanceKey, chatId, buttonResponse, state) => {
    try {
      const funnel = await getFunnelFromRedis(state.funnelId);
      if (!funnel) {
        console.error('Funil não encontrado para resposta de botão');
        return;
      }
  
      const currentNode = funnel.nodes.find(node => node.id === state.currentNodeId);
      if (!currentNode || currentNode.type !== 'button') {
        console.error('Nó atual não é um botão ou não foi encontrado');
        return;
      }
  
      // Encontrar o botão clicado
      const clickedButton = currentNode.buttons.find(
        button => button.displayText.toLowerCase() === buttonResponse.toLowerCase()
      );
  
      if (!clickedButton) {
        console.error('Botão clicado não encontrado:', buttonResponse);
        return;
      }
  
      // Encontrar a conexão correspondente ao botão
      const nextConnection = funnel.connections.find(conn => 
        conn.sourceId === currentNode.id && 
        conn.buttonIndex === currentNode.buttons.indexOf(clickedButton)
      );
  
      if (!nextConnection) {
        console.log('Nenhuma conexão encontrada para o botão:', clickedButton);
        state.currentNodeId = null;
      } else {
        // Atualizar o estado com o próximo nó
        state.currentNodeId = nextConnection.targetId;
        state.status = 'in_progress';
      }
  
      // Salvar o estado atualizado
      const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
      await redisClient.setex(
        autoResponseKey,
        AUTO_RESPONSE_EXPIRY,
        JSON.stringify(state)
      );
  
      // Se houver próximo nó, continuar execução do funil
      if (state.currentNodeId) {
        await executeFunnel(funnel, chatId, instanceKey, state);
      }
  
    } catch (error) {
      console.error('Erro ao processar resposta do botão:', error);
    }
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
        
       /*/ const today = new Date();
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
/*/
if (source === "webhook") {
    const limitCheck = await LimitsService.checkLimit(user._id, 'dailyAutoResponses', 1);
    if (!limitCheck.allowed) {
        console.log('Limite diário de autorespostas atingido:', {
            currentUsage: limitCheck.currentUsage,
            limit: limitCheck.limit
        });
        return;
    }}

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

        // Only increment usage if the source is webhook
   
  
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
                    if (source === "webhook") {
                        const result = await LimitsService.incrementUsage(user._id, 'dailyAutoResponses');
                        await logUserActivity(user._id, ActivityTypes.AUTO_RESPONSE, {
                          phoneNumber: chatId.split('@')[0],
                          campaignName: campaign.name,
                          messageContent: message
                        });
                      }

                      
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
        // Obter o limite efetivo e uso atual usando o LimitsService
        const [effectiveLimit, currentUsage, user] = await Promise.all([
            LimitsService.getEffectiveLimit(userId, 'dailyAutoResponses'),
            LimitsService.getCurrentUsage(userId, 'dailyAutoResponses'),
            User.findById(userId).select('plan')
        ]);

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'Usuário não encontrado' 
            });
        }

        // Verificar se é plano premium ou tem limite personalizado infinito
        const isUnlimited = effectiveLimit === Infinity || effectiveLimit === -1;
        
        // Calcular limite restante
        const remaining = isUnlimited ? 'Ilimitado' : Math.max(0, effectiveLimit - currentUsage);

        res.json({
            success: true,
            usage: currentUsage,
            limit: isUnlimited ? 'Ilimitado' : effectiveLimit,
            remaining,
            isUnlimited,
            plan: user.plan,
            // Informações adicionais que podem ser úteis
            isCustomLimit: await LimitsService.hasCustomLimit(userId, 'dailyAutoResponses'),
            nextReset: await LimitsService.getNextResetTime()
        });

    } catch (error) {
        console.error('Erro ao obter uso de autoresposta:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao obter uso de autoresposta',
            details: error.message
        });
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