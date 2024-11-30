// activityHistoryHelpers.js
const redisClient = require('../config/redisConfig');

// Constantes para tipos de atividades
const ActivityTypes = {
    AUTO_RESPONSE: 'auto_response',
    MASS_MESSAGE: 'mass_message',
    FUNNEL_EDIT: 'funnel_edit',
    INSTANCE_CONNECTION: 'instance_connection',
    CAMPAIGN_UPDATE: 'campaign_update',
    CONTACT_LIST: 'contact_list',
    SETTINGS_UPDATE: 'settings_update'
};

/**
 * Registra uma nova atividade no histórico do usuário
 * @param {string} userId - ID do usuário
 * @param {string} activityType - Tipo da atividade
 * @param {Object} details - Detalhes da atividade
 */
async function logUserActivity(userId, activityType, details) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const activityKey = `user_activity:${userId}:${today.getTime()}`;
        
        const activity = {
            type: activityType,
            timestamp: Date.now(),
            details: details
        };

        // Adiciona a atividade à lista do dia usando LPUSH para manter as mais recentes no início
        await redisClient.lpush(activityKey, JSON.stringify(activity));
        
        // Define expiração de 24 horas a partir do final do dia atual
        const endOfDay = new Date(today);
        endOfDay.setHours(23, 59, 59, 999);
        const ttlInSeconds = Math.floor((endOfDay - new Date()) / 1000);
        
        await redisClient.expire(activityKey, ttlInSeconds);
    } catch (error) {
        console.error('Erro ao registrar atividade:', error);
    }
}

/**
 * Obtém o histórico de atividades do usuário para o dia atual
 * @param {string} userId - ID do usuário
 * @param {number} limit - Limite de atividades a serem retornadas (opcional)
 * @returns {Array} Lista de atividades
 */
async function getUserDailyActivity(userId, limit = 50) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const activityKey = `user_activity:${userId}:${today.getTime()}`;
        
        // Obtém as atividades mais recentes primeiro
        const activities = await redisClient.lrange(activityKey, 0, limit - 1);
        
        return activities.map(activity => {
            const parsed = JSON.parse(activity);
            return {
                ...parsed,
                formattedTime: new Date(parsed.timestamp).toLocaleTimeString()
            };
        });
    } catch (error) {
        console.error('Erro ao obter histórico de atividades:', error);
        return [];
    }
}

/**
 * Formata os detalhes da atividade para exibição
 * @param {string} activityType - Tipo da atividade
 * @param {Object} details - Detalhes da atividade
 * @returns {string} Descrição formatada da atividade
 */
function formatActivityDetails(activityType, details) {
    switch (activityType) {
        case ActivityTypes.AUTO_RESPONSE:
            return `Autoresposta enviada para ${details.phoneNumber} usando campanha "${details.campaignName}"`;
            
        case ActivityTypes.MASS_MESSAGE:
            return `Mensagem em massa enviada para ${details.totalRecipients} contatos`;
            
        case ActivityTypes.FUNNEL_EDIT:
            return `Funil "${details.funnelName}" editado!`;
            
        case ActivityTypes.INSTANCE_CONNECTION:
            return `Instância "${details.instanceName}" ${details.status}`;
            
        case ActivityTypes.CAMPAIGN_UPDATE:
            return `Campanha "${details.campaignName}" ${details.action}`;
            
        case ActivityTypes.CONTACT_LIST:
            return `Lista de contatos "${details.listName}" ${details.action}`;
            
        case ActivityTypes.SETTINGS_UPDATE:
            return `Configurações atualizadas: ${details.settingName}`;
            
        default:
            return 'Atividade registrada';
    }
}

// Exemplo de função para limpar atividades antigas (pode ser executada periodicamente)
async function cleanupOldActivities(userId) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Calcula a chave para o dia anterior
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const oldActivityKey = `user_activity:${userId}:${yesterday.getTime()}`;
        await redisClient.del(oldActivityKey);
    } catch (error) {
        console.error('Erro ao limpar atividades antigas:', error);
    }
}

module.exports = {
    ActivityTypes,
    logUserActivity,
    getUserDailyActivity,
    formatActivityDetails,
    cleanupOldActivities
};