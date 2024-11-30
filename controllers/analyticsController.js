// analyticsController.js
const User = require('../models/User');
const DailyUsage = require('../models/DailyUsage');
const PLAN_LIMITS = require('../config/planLimits');

const redisClient = require('../config/redisConfig');

exports.getDashboardAnalytics = async (req, res) => {
    try {
        const userId = req.user.id;
        const timeframe = req.query.timeframe || 'daily';
        const today = new Date();
        
        let startDate;
        if (timeframe === 'monthly') {
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        } else {
            startDate = new Date(today.setHours(0,0,0,0));
        }
        
        // Buscar usuário com instâncias populadas
        const user = await User.findById(userId)
            .populate('whatsappInstances')
            .populate('notifications')
            .lean();

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const analytics = await Promise.all(user.whatsappInstances.map(async instance => {
            const instanceKey = instance.key;
            
            // Buscar chats da instância
            const chats = await redisClient.smembers(`chats:${instanceKey}`);
            const chatDetails = await Promise.all(chats.map(chatId => 
                redisClient.hgetall(`chat:${instanceKey}:${chatId}`)
            ));

            // Buscar mensagens do dia/mês
            const now = new Date();
            const startOfDay = new Date(now.setHours(0,0,0,0));
            const messagesKey = `messages:${instanceKey}:*`;
            const allMessages = await redisClient.keys(messagesKey);
            
            // Buscar estatísticas dos funis
            const funnelStats = await redisClient.hgetall(`stats:${instanceKey}:${timeframe}:funnels`) || {};
            
            // Estatísticas de localização por DDD
            const locationStats = await getLocationStats(instanceKey, chatDetails);

            // Contagem de funis ativos
            const activeFunnels = await redisClient.keys(`auto_response:${instanceKey}:*`);

            return {
                instanceName: instance.name,
                whatsappName: instance.whatsappName || instance.name,
                phoneNumber: instance.number,
                connectionStatus: instance.isConnected,
                totalChats: chatDetails.length,
                totalContacts: chatDetails.filter(chat => !chat.id?.endsWith('@g.us')).length,
                dailyStats: {
                    newChats: chatDetails.filter(chat => 
                        new Date(parseInt(chat.lastMessageTimestamp) * 1000) > startOfDay
                    ).length,
                    activeChats: chatDetails.filter(chat => chat.unread === 'true').length,
                    funnelsActivated: parseInt(funnelStats.activated || 0),
                    funnelsCompleted: parseInt(funnelStats.completed || 0),
                    activeFunnelsCount: activeFunnels.length,
                    locationBreakdown: locationStats,
                    messageCount: allMessages.length
                }
            };
        }));

        // Calcular métricas globais
        const globalMetrics = analytics.reduce((acc, curr) => ({
            totalChats: acc.totalChats + curr.totalChats,
            totalContacts: acc.totalContacts + curr.totalContacts,
            totalFunnelsActivated: acc.totalFunnelsActivated + curr.dailyStats.funnelsActivated,
            totalFunnelsCompleted: acc.totalFunnelsCompleted + curr.dailyStats.funnelsCompleted,
            totalActiveChats: acc.totalActiveChats + curr.dailyStats.activeChats,
            totalMessageCount: acc.totalMessageCount + curr.dailyStats.messageCount
        }), {
            totalChats: 0,
            totalContacts: 0,
            totalFunnelsActivated: 0,
            totalFunnelsCompleted: 0,
            totalActiveChats: 0,
            totalMessageCount: 0
        });

        res.json({
            success: true,
            timeframe,
            startDate,
            analytics,
            globalMetrics,
            userPlan: user.plan,
            notifications: user.notifications || [],
            planLimits: PLAN_LIMITS[user.plan]
        });

    } catch (error) {
        console.error('Erro ao buscar analytics:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Erro ao buscar analytics',
            details: error.message 
        });
    }
};

// Função auxiliar para calcular estatísticas de localização
async function getLocationStats(instanceKey, chatDetails) {
    const locationStats = {};
    
    chatDetails.forEach(chat => {
        if (chat.id) {
            const phoneNumber = chat.id.split('@')[0];
            if (phoneNumber.startsWith('55')) {
                const ddd = phoneNumber.substring(2, 4);
                locationStats[ddd] = (locationStats[ddd] || 0) + 1;
            }
        }
    });

    return locationStats;
}

exports.getInstanceAnalytics = async (req, res) => {
    try {
        const { instanceKey } = req.params;
        const timeframe = req.query.timeframe || 'daily';

        const stats = await redisClient.hgetall(`stats:${instanceKey}:${timeframe}`);
        const chatStats = await redisClient.hgetall(`stats:${instanceKey}:${timeframe}:chats`);
        const messageStats = await redisClient.hgetall(`stats:${instanceKey}:${timeframe}:messages`);
        const funnelStats = await redisClient.hgetall(`stats:${instanceKey}:${timeframe}:funnels`);

        res.json({
            success: true,
            stats: {
                general: stats,
                chats: chatStats,
                messages: messageStats,
                funnels: funnelStats
            }
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas da instância:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
};

exports.getFunnelAnalytics = async (req, res) => {
    try {
        const timeframe = req.query.timeframe || 'daily';
        const userId = req.user.id;
        
        const funnelStats = await redisClient.hgetall(`user:${userId}:funnels:${timeframe}`);
        const completionRates = await redisClient.hgetall(`user:${userId}:funnels:completion:${timeframe}`);

        res.json({
            success: true,
            stats: {
                activations: funnelStats,
                completions: completionRates
            }
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de funis:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
};

exports.getLocationAnalytics = async (req, res) => {
    try {
        const timeframe = req.query.timeframe || 'daily';
        const instances = req.user.whatsappInstances;
        
        const locationData = {};
        
        for (const instance of instances) {
            const stats = await redisClient.hgetall(`stats:${instance.key}:${timeframe}:locations`);
            
            // Agregar dados de localização
            Object.entries(stats || {}).forEach(([ddd, count]) => {
                const state = getDDDState(ddd);
                locationData[state] = (locationData[state] || 0) + parseInt(count);
            });
        }

        res.json({
            success: true,
            locationData
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de localização:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
};

exports.getTriggerAnalytics = async (req, res) => {
    try {
        const timeframe = req.query.timeframe || 'daily';
        const instances = req.user.whatsappInstances;
        
        const triggerData = {};
        
        for (const instance of instances) {
            const stats = await redisClient.hgetall(`stats:${instance.key}:${timeframe}:triggers`);
            
            // Agregar dados de gatilhos
            Object.entries(stats || {}).forEach(([trigger, count]) => {
                triggerData[trigger] = (triggerData[trigger] || 0) + parseInt(count);
            });
        }

        // Ordenar gatilhos por quantidade de ativações
        const sortedTriggers = Object.entries(triggerData)
            .sort(([,a], [,b]) => b - a)
            .reduce((acc, [key, value]) => ({...acc, [key]: value}), {});

        res.json({
            success: true,
            triggerData: sortedTriggers
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas de gatilhos:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar estatísticas' });
    }
};

// Função auxiliar para mapear DDD para estado
function getDDDState(ddd) {
    const dddMap = {
        '11': 'SP', '21': 'RJ', '31': 'MG',
        // ... adicione outros DDDs conforme necessário
    };
    return dddMap[ddd] || 'Outro';
}

exports.getAnalytics = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('whatsappInstances');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Buscar uso diário dos últimos 7 dias
        const last7Days = Array.from({length: 7}, (_, i) => {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            return d;
        });

        const dailyUsages = await DailyUsage.find({
            userId: user._id,
            date: { $gte: last7Days[6], $lte: last7Days[0] }
        }).sort({ date: 1 });

        // Calcular estatísticas
        const totalMessages = dailyUsages.reduce((sum, usage) => sum + usage.spamMessages, 0);
        const totalAutoreplies = dailyUsages.reduce((sum, usage) => sum + usage.autoResponses, 0);
        const totalFunnels = user.funnels.length;
        const totalGroups = user.whatsappInstances.reduce((acc, instance) => 
            acc + (instance.chats ? instance.chats.filter(chat => chat.isGroup).length : 0), 0);

        // Calcular taxas de engajamento
        const engagementRate = totalMessages > 0 ? ((totalAutoreplies / totalMessages) * 100).toFixed(2) : 0;

        // Preparar dados para gráficos
        const dates = last7Days.map(d => d.toISOString().split('T')[0]).reverse();
        const spamData = dates.map(date => {
            const usage = dailyUsages.find(u => u.date.toISOString().split('T')[0] === date);
            return usage ? usage.spamMessages : 0;
        });
        const autoResponseData = dates.map(date => {
            const usage = dailyUsages.find(u => u.date.toISOString().split('T')[0] === date);
            return usage ? usage.autoResponses : 0;
        });

        // Calcular uso em relação aos limites
        const limits = PLAN_LIMITS[user.plan];
        const usagePercentages = {
            whatsappConnections: (user.whatsappInstances.length / limits.whatsappConnections) * 100,
            funnels: (totalFunnels / limits.funnels) * 100,
            dailySpamMessages: (dailyUsages[0]?.spamMessages / limits.dailySpamMessages) * 100,
            dailyAutoResponses: (dailyUsages[0]?.autoResponses / limits.dailyAutoResponses) * 100
        };

        res.render('analytics', {
            user,
            totalMessages,
            totalAutoreplies,
            totalFunnels,
            totalGroups,
            engagementRate,
            dates,
            spamData,
            autoResponseData,
            usagePercentages,
            limits
        });
    } catch (error) {
        console.error('Erro ao buscar análises:', error);
        res.status(500).render('error', { message: 'Erro ao carregar análises' });
    }
};