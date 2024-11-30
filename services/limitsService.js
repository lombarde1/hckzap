// services/limitsService.js
const User = require('../models/User');
const PLAN_LIMITS = require('../config/planLimits');
const axios = require('axios');
const redisClient = require('../config/redisConfig');
const API_BASE_URL = 'https://api.hocketzap.com';
const APIKEY = 'darkadm';
const { checkAndUpdateDailyUsage, getUserDailyUsage } = require('../Helpers/usageHelper');
const DailyUsage = require('../models/DailyUsage');

class LimitsService {
    static async hasCustomLimit(userId, feature) {
        // Implementação futura para limites personalizados
        return false;
    }
    
    static async incrementUsage(userId, feature) {
        try {
            console.log('Iniciando incremento de uso:', { userId, feature });
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
    
            // Mapear o nome da feature para o campo correto no DailyUsage
            let usageField = feature.replace(/^daily/, '').toLowerCase();
            if (feature === 'dailyAutoResponses') {
                usageField = 'autoResponses';
            } else if (feature === 'dailySpamMessages') {
                usageField = 'spamMessages';
            }
    
            console.log('Campo a ser incrementado:', usageField);
    
            // Primeiro, tentar encontrar o documento existente
            let dailyUsage = await DailyUsage.findOne({
                userId,
                date: {
                    $gte: today,
                    $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                }
            });
    
            if (!dailyUsage) {
                // Se não existir, criar um novo
                dailyUsage = new DailyUsage({
                    userId,
                    date: today,
                    [usageField]: 0
                });
            }
    
            // Incrementar o campo apropriado
            dailyUsage[usageField] = (dailyUsage[usageField] || 0) + 1;
    
            // Salvar as mudanças
            await dailyUsage.save();
    
            console.log('Documento após incremento:', dailyUsage.toObject());
    
            // Verificar se o incremento foi bem sucedido
            const verificacao = await DailyUsage.findOne({
                userId,
                date: {
                    $gte: today,
                    $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                }
            });
    
            console.log('Verificação após salvar:', verificacao ? verificacao.toObject() : 'Não encontrado');
    
            return dailyUsage[usageField];
        } catch (error) {
            console.error('Erro ao incrementar uso:', error);
            throw error;
        }
    }

    static async resetDailyCounters(userId) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
    
            await DailyUsage.findOneAndUpdate(
                { userId, date: today },
                {
                    $set: {
                        autoResponses: 0,
                        spamMessages: 0
                    }
                },
                { upsert: true }
            );
    
            console.log('Contadores resetados para:', userId);
        } catch (error) {
            console.error('Erro ao resetar contadores:', error);
            throw error;
        }
    }

    
    static async checkAndUpdateUsage(userId, feature, increment = 1) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');
    
            const plan = user.plan || 'gratuito';
            
            // Log para debug do plano e feature
            console.log('Verificando uso:', {
                plan,
                feature,
                userPlan: user.plan
            });
    
            // Ajustar o nome da feature para corresponder ao planLimits
            let limitFeature = feature;
            if (!feature.startsWith('daily')) {
                limitFeature = `daily${feature.charAt(0).toUpperCase()}${feature.slice(1)}`;
            }
    
            // Log para debug dos limites
            console.log('Limites do plano:', {
                allLimits: PLAN_LIMITS[plan],
                searchingFor: limitFeature
            });
    
            const limit = PLAN_LIMITS[plan][limitFeature];
            
            if (limit === undefined) {
                console.error('Limite não configurado:', { plan, feature, limitFeature });
                return {
                    success: false,
                    currentUsage: 0,
                    limit: 0,
                    remaining: 0,
                    error: 'Limite não configurado'
                };
            }
    
            const currentUsage = await this.getCurrentUsage(userId, feature);
            const wouldBeUsage = currentUsage + increment;
    
            console.log('Análise de uso:', {
                currentUsage,
                wouldBeUsage,
                limit,
                willIncrement: wouldBeUsage <= limit
            });
    
            if (wouldBeUsage <= limit || limit === Infinity) {
                // Se estiver dentro do limite ou for ilimitado, incrementa o uso
                console.log('Incrementando uso...');
                await this.incrementUsage(userId, feature);
                
                // Atualizar o valor atual após o incremento
                const newUsage = await this.getCurrentUsage(userId, feature);
                console.log('Novo uso após incremento:', newUsage);
    
                return {
                    success: true,
                    currentUsage: newUsage,
                    limit,
                    remaining: limit === Infinity ? Infinity : Math.max(0, limit - newUsage)
                };
            }
    
            return {
                success: false,
                currentUsage,
                limit,
                remaining: Math.max(0, limit - currentUsage)
            };
        } catch (error) {
            console.error('Erro ao verificar e atualizar uso:', error);
            throw error;
        }
    }

    static async enforceInstanceLimits(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const allowedInstances = PLAN_LIMITS[plan].whatsappConnections;
            const currentInstances = user.whatsappInstances.length;

            if (currentInstances > allowedInstances) {
                const excessInstances = currentInstances - allowedInstances;
                const instancesToDelete = user.whatsappInstances.slice(-excessInstances);

                for (const instance of instancesToDelete) {
                    // Primeiro tenta desconectar a instância
                    try {
                        await axios.delete(`${API_BASE_URL}/instance/logout/${instance.name}`, {
                            headers: { 'apikey': APIKEY }
                        });
                    } catch (error) {
                        console.error(`Erro ao desconectar instância ${instance.name}:`, error);
                    }

                    // Depois tenta deletar a instância
                    try {
                        await axios.delete(`${API_BASE_URL}/instance/delete/${instance.name}`, {
                            headers: { 'apikey': APIKEY }
                        });
                    } catch (error) {
                        console.error(`Erro ao deletar instância ${instance.name}:`, error);
                    }
                }

                // Atualiza o documento do usuário removendo as instâncias excedentes
                user.whatsappInstances = user.whatsappInstances.slice(0, allowedInstances);
                await user.save();

                return {
                    enforced: true,
                    deletedCount: excessInstances,
                    currentCount: allowedInstances,
                    limit: allowedInstances
                };
            }

            return {
                enforced: false,
                currentCount: currentInstances,
                limit: allowedInstances
            };
        } catch (error) {
            console.error('Erro ao aplicar limites de instâncias:', error);
            throw error;
        }
    }

    static isUnlimitedFeature(plan, feature) {
        return PLAN_LIMITS[plan]?.[feature] === Infinity;
    }

    static async checkLimit(userId, feature, increment = 0) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const dailyUsage = await getUserDailyUsage(userId);
            const isUnlimited = this.isUnlimitedFeature(plan, feature);
            let currentUsage = 0;

            // Obter uso atual baseado na feature
            switch (feature) {
                case 'funnels':
                    const funnelsKey = `user:${userId}:funnels`;
                    currentUsage = await redisClient.scard(funnelsKey);
                    break;
                case 'dailySpamMessages':
                    currentUsage = dailyUsage.spamMessages;
                    break;
                case 'dailyAutoResponses':
                    currentUsage = dailyUsage.autoResponses;
                    break;
                default:
                    throw new Error('Feature não suportada');
            }

            const limit = isUnlimited ? Number.MAX_SAFE_INTEGER : PLAN_LIMITS[plan][feature];
            const wouldBeUsage = currentUsage + increment;

            return {
                allowed: isUnlimited || wouldBeUsage <= limit,
                currentUsage,
                limit: isUnlimited ? '∞' : limit,
                remaining: isUnlimited ? '∞' : Math.max(0, limit - currentUsage),
                wouldBeUsage,
                isUnlimited
            };
        } catch (error) {
            console.error('Erro ao verificar limite:', error);
            throw error;
        }
    }
    
    static async getPlanLimitsInfo(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const dailyUsage = await getUserDailyUsage(user._id);
            const isUnlimited = (feature) => this.isUnlimitedFeature(plan, feature);

            return {
                whatsappConnections: {
                    limit: PLAN_LIMITS[plan].whatsappConnections,
                    current: user.whatsappInstances.length,
                    isUnlimited: isUnlimited('whatsappConnections')
                },
                dailyAutoResponses: {
                    limit: isUnlimited('dailyAutoResponses') ? '∞' : PLAN_LIMITS[plan].dailyAutoResponses,
                    current: dailyUsage.autoResponses,
                    isUnlimited: isUnlimited('dailyAutoResponses')
                },
                dailySpamMessages: {
                    limit: isUnlimited('dailySpamMessages') ? '∞' : PLAN_LIMITS[plan].dailySpamMessages,
                    current: dailyUsage.spamMessages,
                    isUnlimited: isUnlimited('dailySpamMessages')
                },
                funnels: {
                    limit: isUnlimited('funnels') ? '∞' : PLAN_LIMITS[plan].funnels,
                    current: await this.getCurrentUsage(userId, 'funnels'),
                    isUnlimited: isUnlimited('funnels'),
                    remaining: isUnlimited('funnels') ? '∞' : Math.max(0, PLAN_LIMITS[plan].funnels - await this.getCurrentUsage(userId, 'funnels'))
                }
            };
        } catch (error) {
            console.error('Erro ao obter informações dos limites do plano:', error);
            throw error;
        }
    }


    static async incrementUsage(userId, feature) {
        try {
            console.log('Iniciando incremento de uso:', { userId, feature });
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
    
            // Mapear o nome da feature para o campo correto no DailyUsage
            let usageField;
            switch (feature) {
                case 'dailyAutoResponses':
                    usageField = 'autoResponses';
                    break;
                case 'dailySpamMessages':
                    usageField = 'spamMessages';
                    break;
                default:
                    usageField = feature.replace(/^daily/, '').toLowerCase();
            }
    
            console.log('Campo a ser incrementado:', usageField);
    
            // Usar findOneAndUpdate para garantir atomicidade
            const dailyUsage = await DailyUsage.findOneAndUpdate(
                {
                    userId,
                    date: {
                        $gte: today,
                        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                    }
                },
                {
                    $inc: { [usageField]: 1 },
                    $setOnInsert: { date: today }
                },
                {
                    new: true,
                    upsert: true,
                    setDefaultsOnInsert: true
                }
            );
    
            console.log('Uso incrementado com sucesso:', dailyUsage.toObject());
            return dailyUsage[usageField];

        } catch (error) {
            console.error('Erro ao incrementar uso:', error);
            throw error;
        }
    }
    
    static async getEffectiveLimit(userId, feature) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const limit = PLAN_LIMITS[plan][feature];

            // Se o limite for Infinity, retornar um valor numérico grande
            return limit === Infinity ? Number.MAX_SAFE_INTEGER : limit;
        } catch (error) {
            console.error('Erro ao obter limite efetivo:', error);
            throw error;
        }
    }

    static async enforceLimit(userId, feature) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const limit = PLAN_LIMITS[plan][feature];

            switch (feature) {
                case 'funnels':
                    const funnelsKey = `user:${userId}:funnels`;
                    const currentFunnels = await redisClient.smembers(funnelsKey);
                    
                    if (currentFunnels.length > limit) {
                        const toRemove = currentFunnels.slice(limit);
                        for (const funnelId of toRemove) {
                            await redisClient.srem(funnelsKey, funnelId);
                            await redisClient.del(`funnel:${funnelId}`);
                        }
                        return {
                            enforced: true,
                            removed: toRemove.length,
                            remaining: limit
                        };
                    }
                    break;
            }

            return {
                enforced: false,
                currentUsage: await this.getCurrentUsage(userId, feature),
                limit
            };
        } catch (error) {
            console.error('Erro ao aplicar limite:', error);
            throw error;
        }
    }



  static async getCurrentUsage(userId, feature) {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyUsage = await DailyUsage.findOne({
            userId,
            date: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        if (!dailyUsage) {
            return 0;
        }

        switch (feature) {
            case 'dailyAutoResponses':
                return dailyUsage.autoResponses || 0;
            case 'dailySpamMessages':
                return dailyUsage.spamMessages || 0;
            case 'whatsappConnections':
                const user = await User.findById(userId);
                return user ? user.whatsappInstances.length : 0;
            case 'funnels':
                const funnelsKey = `user:${userId}:funnels`;
                return await redisClient.scard(funnelsKey);
            default:
                return 0;
        }
    } catch (error) {
        console.error('Erro ao obter uso atual:', error);
        throw error;
    }
}

    static async getNextResetTime() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
    }
    static async checkInstanceLimit(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) throw new Error('Usuário não encontrado');

            const plan = user.plan || 'gratuito';
            const allowedInstances = PLAN_LIMITS[plan].whatsappConnections;
            const currentInstances = user.whatsappInstances.length;

            return {
                allowed: currentInstances < allowedInstances,
                currentCount: currentInstances,
                limit: allowedInstances,
                remaining: Math.max(0, allowedInstances - currentInstances)
            };
        } catch (error) {
            console.error('Erro ao verificar limite de instâncias:', error);
            throw error;
        }
    }

    static async handlePlanChange(userId, newPlan) {
        try {
            // Quando o plano do usuário mudar, enforce os novos limites
            const result = await this.enforceInstanceLimits(userId);
            return result;
        } catch (error) {
            console.error('Erro ao lidar com mudança de plano:', error);
            throw error;
        }
    }
}

module.exports = LimitsService;