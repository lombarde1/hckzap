// controllers/limitsController.js
const LimitsService = require('../services/limitsService');
const User = require('../models/User');

exports.getUserLimits = async (req, res) => {
    try {
        const userId = req.params.userId || req.user.id;
        const effectiveLimits = await LimitsService.getUserEffectiveLimits(userId);
        
        // Obter uso atual para cada tipo de limite
        const usagePromises = Object.keys(effectiveLimits).map(async limitType => {
            const currentUsage = await LimitsService.getCurrentUsage(userId, limitType);
            return {
                type: limitType,
                limit: effectiveLimits[limitType],
                currentUsage,
                remaining: effectiveLimits[limitType] - currentUsage
            };
        });

        const limitsWithUsage = await Promise.all(usagePromises);

        res.json({
            success: true,
            limits: limitsWithUsage
        });
    } catch (error) {
        console.error('Erro ao obter limites:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.setCustomLimit = async (req, res) => {
    try {
        const { userId, limitType, limit } = req.body;

        // Validar se o limitType é válido
        const validLimitTypes = [
            'whatsappConnections',
            'dailySpamMessages',
            'dailyAutoResponses',
            'funnels',
            'hocketLinks'
        ];

        if (!validLimitTypes.includes(limitType)) {
            return res.status(400).json({
                success: false,
                error: 'Tipo de limite inválido'
            });
        }

        const updatedLimits = await LimitsService.setCustomLimit(userId, limitType, limit);

        // Registrar a alteração
        const user = await User.findById(userId);
        user.notifications.push({
            title: 'Limite Personalizado',
            content: `Seu limite de ${limitType} foi alterado para ${limit}`,
            timestamp: new Date()
        });
        await user.save();

        res.json({
            success: true,
            limits: updatedLimits
        });
    } catch (error) {
        console.error('Erro ao definir limite personalizado:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.setTemporaryLimit = async (req, res) => {
    try {
        const { userId, limitType, limit, expirationDate } = req.body;

        const updatedLimits = await LimitsService.setTemporaryLimit(
            userId,
            limitType,
            limit,
            new Date(expirationDate)
        );

        // Notificar usuário
        const user = await User.findById(userId);
        user.notifications.push({
            title: 'Limite Temporário Ativado',
            content: `Você recebeu um limite temporário de ${limit} para ${limitType} até ${new Date(expirationDate).toLocaleDateString()}`,
            timestamp: new Date()
        });
        await user.save();

        res.json({
            success: true,
            limits: updatedLimits
        });
    } catch (error) {
        console.error('Erro ao definir limite temporário:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.resetLimits = async (req, res) => {
    try {
        const { userId } = req.params;
        await LimitsService.resetToPlanLimits(userId);

        // Notificar usuário
        const user = await User.findById(userId);
        user.notifications.push({
            title: 'Limites Resetados',
            content: 'Seus limites foram resetados para os padrões do seu plano',
            timestamp: new Date()
        });
        await user.save();

        res.json({
            success: true,
            message: 'Limites resetados com sucesso'
        });
    } catch (error) {
        console.error('Erro ao resetar limites:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

exports.checkLimit = async (req, res) => {
    try {
        const { userId, limitType, amount } = req.query;
        const checkResult = await LimitsService.checkLimit(userId, limitType, parseInt(amount) || 1);

        res.json({
            success: true,
            ...checkResult
        });
    } catch (error) {
        console.error('Erro ao verificar limite:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};