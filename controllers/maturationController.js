const MaturationService = require('../services/maturationService');
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/User');
const OnlineInstanceService = require('../services/onlineInstanceService');

class MaturationController {
    async renderDashboard(req, res) {
        try {
            const user = await User.findById(req.user.id)
                .populate('whatsappInstances');
            
            const activeSessions = await MaturationService.getAllActiveSessions();
            const userSessions = activeSessions.filter(
                session => session.user._id.toString() === req.user.id
            );
            const onlineCount = await OnlineInstanceService.getOnlineCount();

            res.render('maturation/dashboard', {
                user,
                instances: user.whatsappInstances,
                activeSessions: userSessions,
                onlineUsers: onlineCount
            });
        } catch (error) {
            console.error('Error rendering dashboard:', error);
            res.status(500).render('error', { 
                message: 'Erro ao carregar dashboard de maturação'
            });
        }
    }

    async toggleSession(req, res) {
    try {
        const { sessionId, action } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'ID da sessão é obrigatório'
            });
        }

        if (action === 'pause') {
            await MaturationService.pauseSession(sessionId);
        } else if (action === 'resume') {
            await MaturationService.resumeSession(sessionId);
        } else {
            return res.status(400).json({
                success: false,
                message: 'Ação inválida'
            });
        }

        res.json({
            success: true,
            message: `Sessão ${action === 'pause' ? 'pausada' : 'retomada'} com sucesso`
        });
    } catch (error) {
        console.error('Error toggling session:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao alterar estado da sessão',
            error: error.message
        });
    }
}

async stopSession(req, res) {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'ID da sessão é obrigatório'
            });
        }

        await MaturationService.stopSession(sessionId);

        res.json({
            success: true,
            message: 'Sessão encerrada com sucesso'
        });
    } catch (error) {
        console.error('Error stopping session:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao encerrar sessão',
            error: error.message
        });
    }
}

    async startMaturation(req, res) {
        try {
            const { instanceKey, methods, durationDays } = req.body;

            // Validações
            if (!instanceKey || !methods || !durationDays) {
                return res.status(400).json({
                    success: false,
                    message: 'Parâmetros inválidos'
                });
            }

            // Verifica se já existe uma sessão ativa para esta instância
            const existingSession = await MaturationService.getActiveSessionByInstance(instanceKey);
            if (existingSession) {
                return res.status(400).json({
                    success: false,
                    message: 'Já existe uma sessão ativa para esta instância'
                });
            }

            const session = await MaturationService.startSession(
                req.user.id,
                instanceKey,
                {
                    methods,
                    durationDays: parseInt(durationDays)
                }
            );

            res.json({
                success: true,
                message: 'Maturação iniciada com sucesso',
                session: {
                    id: session._id,
                    status: session.status,
                    methods: session.methods,
                    configuration: session.configuration
                }
            });
        } catch (error) {
            console.error('Error starting maturation:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao iniciar maturação',
                error: error.message
            });
        }
    }

    async getSessionStats(req, res) {
        try {
            const { sessionId } = req.params;
            const stats = await MaturationService.getSessionStats(sessionId);

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            console.error('Error getting session stats:', error);
            res.status(500).json({
                success: false,
                message: 'Erro ao buscar estatísticas da sessão',
                error: error.message
            });
        }
    }

    

    // Webhook handler para eventos do WhatsApp
    async handleWebhook(req, res) {
        try {
            await MaturationService.handleWebhook(req.body);
            res.status(200).send('OK');
        } catch (error) {
            console.error('Error handling webhook:', error);
            res.status(500).send('Error');
        }
    }
}

module.exports = new MaturationController();