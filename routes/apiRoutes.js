// routes/apiRoutes.js

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/User');
const LimitsService = require('../services/limitsService');
const { getUserDailyUsage } = require('../Helpers/usageHelper');
const redisClient = require('../config/redisConfig');
const axios = require('axios');
const PLAN_LIMITS = require('../config/planLimits');
const API_BASE_URL = 'https://api.hocketzap.com';
const APIKEY = 'darkadm';

// Endpoint para obter dados gerais do usuário
router.get('/user/stats', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const dailyUsage = await getUserDailyUsage(user._id);
        const plan = user.plan || 'gratuito';
        // Obter contagem de funis do Redis
        const funnelsKey = `user:${user._id}:funnels`;
        const totalFunnels = await redisClient.scard(funnelsKey);
        
        // Obter todos os limites necessários
        const [
            spamLimit,
            autoResponseLimit,
            whatsappLimit,
            funnelLimit
        ] = await Promise.all([
            LimitsService.getEffectiveLimit(user._id, 'dailySpamMessages'),
            LimitsService.getEffectiveLimit(user._id, 'dailyAutoResponses'),
            LimitsService.getEffectiveLimit(user._id, 'whatsappConnections'),
            LimitsService.getEffectiveLimit(user._id, 'funnels')
        ]);

        // Buscar instâncias ativas
        const instanceResponse = await axios.get(`${API_BASE_URL}/instance/fetchInstances`, {
            headers: { 'apikey': APIKEY }
        });

        const activeInstances = instanceResponse.data.filter(instance => 
            user.whatsappInstances.some(userInstance => 
                userInstance.key === instance.token && 
                instance.connectionStatus === 'open'
            )
        );

        const nextReset = await LimitsService.getNextResetTime();
        const isUnlimited = (feature) => PLAN_LIMITS[plan][feature] === Infinity;
        const getLimit = (feature) => {
            const limit = PLAN_LIMITS[plan][feature];
            return limit === Infinity ? Number.MAX_SAFE_INTEGER : limit;
        };
        // Resposta atualizada incluindo informações detalhadas sobre funis
        res.json({
            user: {
                name: user.name,
                email: user.email,
                id: user._id,
                plan: user.plan,
                validUntil: user.validUntil
            },
            instances: {
                total: user.whatsappInstances.length,
                active: activeInstances.length,
                limit: PLAN_LIMITS[plan].whatsappConnections,
                currentUsage: user.whatsappInstances.length,
                isUnlimited: isUnlimited('whatsappConnections')
            },
            funnels: {
                total: totalFunnels,
                limit: getLimit('funnels'),
                isUnlimited: isUnlimited('funnels'),
                remaining: isUnlimited('funnels') ? 
                    Number.MAX_SAFE_INTEGER - totalFunnels : 
                    Math.max(0, PLAN_LIMITS[plan].funnels - totalFunnels)
            },
            usage: {
                daily: {
                    autoResponses: {
                        used: dailyUsage.autoResponses,
                        limit: getLimit('dailyAutoResponses'),
                        isUnlimited: isUnlimited('dailyAutoResponses'),
                        nextReset
                    },
                    spamMessages: {
                        used: dailyUsage.spamMessages,
                        limit: getLimit('dailySpamMessages'),
                        isUnlimited: isUnlimited('dailySpamMessages'),
                        nextReset
                    }
                }
            }
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});


router.get('/funnels/metrics', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const funnelsKey = `user:${user._id}:funnels`;
        const funnelIds = await redisClient.smembers(funnelsKey);

        // Buscar dados de todos os funis
        const funnels = await Promise.all(
            funnelIds.map(async (funnelId) => {
                const funnelData = await redisClient.get(`funnel:${funnelId}`);
                return JSON.parse(funnelData);
            })
        );

        // Obter limite de funis
        const funnelLimit = await LimitsService.getEffectiveLimit(user._id, 'funnels');

        // Estatísticas dos funis
        const funnelStats = {
            total: funnels.length,
            active: funnels.filter(f => f.isActive).length,
            withAutoResponse: funnels.filter(f => f.hasAutoResponse).length,
            withMassMessage: funnels.filter(f => f.hasMassMessage).length
        };

        res.json({
            metrics: funnelStats,
            limits: {
                current: funnels.length,
                max: funnelLimit,
                remaining: Math.max(0, funnelLimit - funnels.length),
                isUnlimited: funnelLimit === Infinity
            },
            funnels: funnels.map(f => ({
                id: f.id,
                name: f.name,
                nodesCount: f.nodes?.length || 0,
                connectionsCount: f.connections?.length || 0,
                createdAt: f.createdAt,
                lastModified: f.updatedAt
            }))
        });

    } catch (error) {
        console.error('Erro ao buscar métricas de funis:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas de funis' });
    }
});

// Endpoint para dados de uso diário
router.get('/usage/daily', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const dailyUsage = await getUserDailyUsage(userId);
        const [autoResponseLimit, spamLimit] = await Promise.all([
            LimitsService.getEffectiveLimit(userId, 'dailyAutoResponses'),
            LimitsService.getEffectiveLimit(userId, 'dailySpamMessages')
        ]);

        res.json({
            currentUsage: {
                autoResponses: {
                    current: dailyUsage.autoResponses,
                    limit: autoResponseLimit,
                    isUnlimited: autoResponseLimit === Infinity
                },
                messages: {
                    current: dailyUsage.spamMessages,
                    limit: spamLimit,
                    isUnlimited: spamLimit === Infinity
                }
            },
            nextReset: await LimitsService.getNextResetTime()
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar uso diário' });
    }
});

// Endpoint para métricas de autoresposta
router.get('/autoresponse/metrics', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const dailyUsage = await getUserDailyUsage(user._id);
        const autoResponseLimit = await LimitsService.getEffectiveLimit(user._id, 'dailyAutoResponses');
        const metrics = [];

        for (const instance of user.whatsappInstances) {
            metrics.push({
                instanceName: instance.name,
                totalResponses: instance.autoResponseCount || 0,
                activeResponses: instance.autoResponse?.isActive ? 1 : 0,
                funnelId: instance.autoResponse?.funnelId
            });
        }

        res.json({ 
            metrics,
            limits: {
                current: dailyUsage.autoResponses,
                max: autoResponseLimit,
                remaining: Math.max(0, autoResponseLimit - dailyUsage.autoResponses),
                isUnlimited: autoResponseLimit === Infinity,
                nextReset: await LimitsService.getNextResetTime()
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar métricas de autoresposta' });
    }
});

// Endpoint para dados do plano
router.get('/plan/details', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const dailyUsage = await getUserDailyUsage(user._id);
        const funnelsKey = `user:${user._id}:funnels`;
        const totalFunnels = await redisClient.scard(funnelsKey);
        const plan = user.plan || 'gratuito';
        
        // Função auxiliar para verificar se o recurso é ilimitado
        const isUnlimited = (feature) => PLAN_LIMITS[plan][feature] === Infinity;
        
        // Função para obter o limite formatado
        const getLimit = (feature) => {
            const limit = PLAN_LIMITS[plan][feature];
            return limit === Infinity ? Number.MAX_SAFE_INTEGER : limit;
        };

        const limits = {
            whatsappConnections: {
                limit: PLAN_LIMITS[plan].whatsappConnections, // Este não é infinito em nenhum plano
                current: user.whatsappInstances.length,
                isUnlimited: isUnlimited('whatsappConnections')
            },
            dailyAutoResponses: {
                limit: getLimit('dailyAutoResponses'),
                current: dailyUsage.autoResponses,
                isUnlimited: isUnlimited('dailyAutoResponses')
            },
            dailySpamMessages: {
                limit: getLimit('dailySpamMessages'),
                current: dailyUsage.spamMessages,
                isUnlimited: isUnlimited('dailySpamMessages')
            },
            funnels: {
                limit: getLimit('funnels'),
                current: totalFunnels,
                isUnlimited: isUnlimited('funnels'),
                remaining: isUnlimited('funnels') ? 
                    Number.MAX_SAFE_INTEGER - totalFunnels : 
                    Math.max(0, PLAN_LIMITS[plan].funnels - totalFunnels)
            }
        };

        res.json({
            currentPlan: user.plan,
            validUntil: user.validUntil,
            limits,
            nextReset: await LimitsService.getNextResetTime()
        });
    } catch (error) {
        console.error('Erro ao buscar detalhes do plano:', error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do plano' });
    }
});


// Endpoint para métricas de mensagens
router.get('/messages/metrics', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const dailyUsage = await getUserDailyUsage(user._id);
        const spamLimit = await LimitsService.getEffectiveLimit(user._id, 'dailySpamMessages');
        let totalMessages = 0;
        const instanceMetrics = [];

        for (const instance of user.whatsappInstances) {
            try {
                const response = await axios.get(
                    `${API_BASE_URL}/instance/info/${instance.name}`,
                    { headers: { 'apikey': APIKEY } }
                );

                const metrics = {
                    instanceName: instance.name,
                    messageCount: response.data.messageCount || 0,
                    lastMessage: response.data.lastMessage,
                    activeChats: response.data.activeChats
                };

                totalMessages += metrics.messageCount;
                instanceMetrics.push(metrics);
            } catch (error) {
              //  console.error(`Erro ao buscar métricas para instância ${instance.name}:`, error);
            }
        }

        res.json({
            totalMessages,
            instanceMetrics,
            limits: {
                current: dailyUsage.spamMessages,
                max: spamLimit,
                remaining: Math.max(0, spamLimit - dailyUsage.spamMessages),
                isUnlimited: spamLimit === Infinity,
                nextReset: await LimitsService.getNextResetTime()
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar métricas de mensagens' });
    }
});

module.exports = router;