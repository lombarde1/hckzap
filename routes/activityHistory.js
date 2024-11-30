// routes/activityHistory.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { getUserDailyActivity, formatActivityDetails } = require('../Helpers/activityHistoryHelpers');

// Rota principal para obter histórico de atividades
router.get('/history', ensureAuthenticated, async (req, res) => {
    try {
        // Permite especificar um limite via query parameter
        const limit = parseInt(req.query.limit) || 50;
        const activities = await getUserDailyActivity(req.user.id, limit);
        
        // Formata as atividades para o dashboard
        const formattedActivities = activities.map(activity => {
            const parsed = typeof activity === 'string' ? JSON.parse(activity) : activity;
            return {
                id: parsed.timestamp, // Usando timestamp como ID único
                type: parsed.type,
                description: formatActivityDetails(parsed.type, parsed.details),
                details: parsed.details,
                timestamp: parsed.timestamp,
                timeFormatted: new Date(parsed.timestamp).toLocaleString('pt-BR'),
                timeAgo: formatTimeAgo(parsed.timestamp)
            };
        });

        // Agrupa atividades por tipo para estatísticas
        const stats = formattedActivities.reduce((acc, activity) => {
            acc[activity.type] = (acc[activity.type] || 0) + 1;
            return acc;
        }, {});

        res.json({
            success: true,
            data: {
                activities: formattedActivities,
                stats: stats,
                total: formattedActivities.length,
                summary: {
                    autoResponses: stats.auto_response || 0,
                    massMessages: stats.mass_message || 0,
                    funnelEdits: stats.funnel_edit || 0,
                    instanceConnections: stats.instance_connection || 0
                }
            }
        });
    } catch (error) {
        console.error('Erro ao obter histórico:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar histórico de atividades',
            details: error.message
        });
    }
});

// Rota para obter estatísticas resumidas
router.get('/stats', ensureAuthenticated, async (req, res) => {
    try {
        const activities = await getUserDailyActivity(req.user.id);
        
        // Calcula estatísticas gerais
        const stats = activities.reduce((acc, activityStr) => {
            const activity = typeof activityStr === 'string' ? JSON.parse(activityStr) : activityStr;
            
            // Incrementa contagem por tipo
            acc.byType[activity.type] = (acc.byType[activity.type] || 0) + 1;
            
            // Calcula distribuição por hora
            const hour = new Date(activity.timestamp).getHours();
            acc.byHour[hour] = (acc.byHour[hour] || 0) + 1;
            
            return acc;
        }, { 
            byType: {},
            byHour: Array(24).fill(0)
        });

        res.json({
            success: true,
            data: {
                totalActivities: activities.length,
                typeDistribution: stats.byType,
                hourlyDistribution: stats.byHour,
                mostActiveHour: stats.byHour.indexOf(Math.max(...stats.byHour))
            }
        });
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao carregar estatísticas',
            details: error.message
        });
    }
});

// Rota para buscar atividades específicas por tipo
router.get('/filter/:type', ensureAuthenticated, async (req, res) => {
    try {
        const { type } = req.params;
        const activities = await getUserDailyActivity(req.user.id);
        
        const filteredActivities = activities
            .map(activityStr => typeof activityStr === 'string' ? JSON.parse(activityStr) : activityStr)
            .filter(activity => activity.type === type)
            .map(activity => ({
                description: formatActivityDetails(activity.type, activity.details),
                details: activity.details,
                timestamp: activity.timestamp,
                timeFormatted: new Date(activity.timestamp).toLocaleString('pt-BR'),
                timeAgo: formatTimeAgo(activity.timestamp)
            }));

        res.json({
            success: true,
            data: {
                type: type,
                activities: filteredActivities,
                count: filteredActivities.length
            }
        });
    } catch (error) {
        console.error('Erro ao filtrar atividades:', error);
        res.status(500).json({
            success: false,
            error: 'Erro ao filtrar atividades',
            details: error.message
        });
    }
});

function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'agora mesmo';
    if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} atrás`;
    }
    if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        return `${hours} ${hours === 1 ? 'hora' : 'horas'} atrás`;
    }
    return 'hoje';
}

module.exports = router;