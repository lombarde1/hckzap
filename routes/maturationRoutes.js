const express = require('express');
const router = express.Router();
const maturationController = require('../controllers/maturationController');
const { ensureAuthenticated } = require('../middleware/auth');
const MaturationService = require('../services/maturationService');
const OnlineInstanceService = require('../services/onlineInstanceService');

// Rota principal - Dashboard
router.get('/', ensureAuthenticated, maturationController.renderDashboard);

router.get('/online-instances', ensureAuthenticated, async (req, res) => {
    try {
        const onlineInstances = await OnlineInstanceService.getOnlineInstances();
        res.json({
            success: true,
            data: onlineInstances
        });
    } catch (error) {
        console.error('Error getting online instances:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar instâncias online',
            error: error.message
        });
    }
});

// Iniciar nova maturação
router.post('/start', ensureAuthenticated, maturationController.startMaturation);

// Obter estatísticas de uma sessão
router.get('/sessions/:sessionId/stats', ensureAuthenticated, maturationController.getSessionStats);


// Adicione em maturationRoutes.js
router.get('/history', ensureAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        const history = await MaturationService.getSessionHistory(page, limit);
        res.json(history);
    } catch (error) {
        console.error('Error fetching session history:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar histórico de sessões',
            error: error.message
        });
    }
});

// Listar todas as sessões ativas
// maturationRoutes.js
router.get('/sessions', ensureAuthenticated, async (req, res) => {
    try {
        const sessions = await MaturationService.getAllActiveSessions();
        const onlineCount = await MaturationService.syncOnlineUsers();

        const enrichedSessions = sessions.map(session => ({
            id: session.id || session._id,
            instanceKey: session.instanceKey,
            user: session.user,
            startDate: session.configuration.startDate,
            progress: {
                totalGroups: session.activities.length,
                processedGroups: session.activities.filter(a => a.type === 'owner_message').length,
                successfulInteractions: session.activities.filter(a => a.details.success).length,
                failedInteractions: session.activities.filter(a => !a.details.success).length,
                percentageComplete: calculateSessionProgress(session)
            },
            stats: {
                interactions: {
                    total: session.activities.length,
                    successful: session.activities.filter(a => a.details.success).length
                }
            },
            methods: session.methods,
            status: session.status,
            configuration: session.configuration,
            activities: session.activities.slice(-5),
            nextScheduledAction: session.nextScheduledAction,
            isOnline: session.methods.p2pCommunication?.onlineStatus || false
        }));

        res.json({
            sessions: enrichedSessions,
            onlineUsers: onlineCount
        });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar sessões',
            error: error.message
        });
    }
});

function calculateSessionProgress(session) {
    if (!session.configuration || !session.configuration.startDate || !session.configuration.endDate) {
        return 0;
    }

    const start = new Date(session.configuration.startDate);
    const end = new Date(session.configuration.endDate);
    const now = new Date();
    
    // Se já passou da data final
    if (now > end) return 100;
    // Se ainda não começou
    if (now < start) return 0;
    
    // Cálculo baseado no tempo e ações
    const totalTimeInMs = end.getTime() - start.getTime();
    const elapsedTimeInMs = now.getTime() - start.getTime();
    const timeProgress = (elapsedTimeInMs / totalTimeInMs) * 100;

    // Cálculo baseado nas ações
    let actionsProgress = 0;
    if (session.methods.groupOwnerInteraction.enabled) {
        const daysElapsed = Math.ceil(elapsedTimeInMs / (1000 * 60 * 60 * 24));
        const totalExpectedActions = session.methods.groupOwnerInteraction.dailyLimit * 
                                   Math.min(daysElapsed, session.configuration.durationDays);
        const completedActions = session.activities ? session.activities.length : 0;
        actionsProgress = (completedActions / totalExpectedActions) * 100;
    }

    // Média ponderada: 40% tempo, 60% ações
    const totalProgress = (timeProgress * 0.4) + (actionsProgress * 0.6);
    return Math.min(Math.round(totalProgress), 100);
}
// Pausar/Retomar sessão
router.post('/sessions/:sessionId/toggle', ensureAuthenticated, maturationController.toggleSession);

// Encerrar sessão
router.delete('/sessions/:sessionId', ensureAuthenticated, maturationController.stopSession);

// Webhook para eventos do WhatsApp
router.post('/webhook', maturationController.handleWebhook);

module.exports = router;