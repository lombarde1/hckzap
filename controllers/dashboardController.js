// controllers/dashboardController.js
const User = require('../models/User');
const DailyUsage = require('../models/DailyUsage');
const redisClient = require('../config/redisConfig');
const { getChats, getMessages } = require('../Helpers/redisHelpers');
const axios = require("axios")
const PLAN_LIMITS = require('../config/planLimits');

exports.getDashboardData = async (userId, user2) => {
    try {
        const user = await User.findById(userId);
     
        if (!user) {
            throw new Error('Usuário não encontrado');
        }

        // Buscar dados do Redis para cada instância
        const instanceStats = await Promise.all(user.whatsappInstances.map(async (instance) => {
            const chats = await getChats(instance.name);
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            // Contar mensagens de hoje
            let todayMessages = 0;
            for (const chat of chats) {
                const messages = await getMessages(instance.name, chat.id);
                todayMessages += messages.filter(msg => {
                    const msgTimestamp = msg.timestamp * 1000;
                    return msgTimestamp > todayStart.getTime();
                }).length;
            }

            // Buscar funis ativos da instância do Redis
            const funnelsKey = `user:${userId}:funnels`;
            const funnelIds = await redisClient.smembers(funnelsKey);
            const activeFunnels = await Promise.all(funnelIds.map(async (funnelId) => {
                const funnelData = await redisClient.get(`funnel:${funnelId}`);
                return funnelData ? JSON.parse(funnelData) : null;
            }));

            // Filtrar funis nulos e contar funis ativos
            const validFunnels = activeFunnels.filter(funnel => funnel !== null);

            // Buscar informações da instância da API
            const instanceDetails = await axios.get(`https://api.hocketzap.com/instance/fetchInstances`, {
                headers: { 'apikey': "darkadm" }
            });
            
            const currentInstance = instanceDetails.data.find(i => i.token === instance.key);

            return {
                name: instance.name,
                isConnected: currentInstance ? currentInstance.connectionStatus === 'open' : false,
                profileImage: currentInstance ? currentInstance.profilePicUrl : '',
                whatsappName: currentInstance ? currentInstance.profileName : '',
                todayMessages,
                activeFunnels: validFunnels.length,
                todayFunnelTriggers: 0 // Este valor pode ser atualizado se você tiver uma forma de rastrear disparos
            };
        }));

        // Buscar uso diário com a data correta
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let dailyUsage = await DailyUsage.findOne({ 
          userId: user2._id, 
          date: today 
        });
      
       

        // Obter limites do plano do usuário
        const planLimits = PLAN_LIMITS[user.plan] || PLAN_LIMITS['gratuito'];

        return {
            user,
            stats: {
                totalInstances: user.whatsappInstances.length,
                connectedInstances: instanceStats.filter(i => i.isConnected).length,
                todayMessages: instanceStats.reduce((sum, i) => sum + i.todayMessages, 0),
                activeFunnels: instanceStats.reduce((sum, i) => sum + i.activeFunnels, 0),
                todayFunnelTriggers: instanceStats.reduce((sum, i) => sum + i.todayFunnelTriggers, 0),
                todayAutoResponses:  dailyUsage.autoResponses,
                todaySpamMessages: dailyUsage.spamMessages
            },
            limits: {
                instances: planLimits.whatsappConnections,
                dailySpamMessages: planLimits.dailySpamMessages,
                funnels: planLimits.funnels,
                autoResponses: planLimits.dailyAutoResponses
            },
            instances: instanceStats,
            hourlyStats: await getHourlyStats(user.whatsappInstances)
        };
    } catch (error) {
        console.error('Erro ao buscar dados do dashboard:', error);
        throw error;
    }
};

// Função auxiliar para obter estatísticas por hora
async function getHourlyStats(instances) {
    const labels = Array.from({length: 24}, (_, i) => `${i}h`);
    const hourlyData = new Array(24).fill(0);

    try {
        for (const instance of instances) {
            const hourlyStats = await redisClient.get(`hourly_stats:${instance.name}`);
            if (hourlyStats) {
                const parsed = JSON.parse(hourlyStats);
                parsed.forEach((count, hour) => {
                    hourlyData[hour] += count;
                });
            }
        }

        return {
            labels,
            data: hourlyData
        };
    } catch (error) {
        console.error('Erro ao buscar estatísticas por hora:', error);
        return { labels, data: hourlyData };
    }
}