
// services/p2pService.js
const OnlineInstance = require('../models/OnlineInstance');
const axios = require('axios');

class P2PService {
    constructor() {
        this.API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
        this.CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutos
        this.INTERACTION_INTERVAL = 10 * 60 * 1000; // 10 minutos
        this.OFFLINE_THRESHOLD = 10 * 60 * 1000; // 10 minutos

        // Iniciar limpeza automática de instâncias offline
        setInterval(() => this.cleanupOfflineInstances(), this.CLEANUP_INTERVAL);
        
        // Iniciar interações P2P automáticas
        setInterval(() => this.processP2PInteractions(), this.INTERACTION_INTERVAL);
    }

    async getInstanceDetails(instanceKey) {
        try {
            const response = await axios.get(
                `${this.API_BASE_URL}/instance/fetchInstances`,
                { headers: { apikey: 'darkadm' } }
            );

            const instance = response.data.find(inst => inst.name === instanceKey);
            if (!instance || !instance.number) {
                console.log('[P2P] Instância sem número:', instanceKey);
                return null;
            }

            return {
                name: instance.name,
                number: instance.number.replace(/\D/g, ''),
                token: instance.name
            };
        } catch (error) {
            console.error('[P2P] Erro ao buscar detalhes:', error);
            return null;
        }
    }

    async startP2P(instanceKey) {
        try {
            const instanceDetails = await this.getInstanceDetails(instanceKey);
            if (!instanceDetails) {
                throw new Error('Não foi possível obter detalhes da instância');
            }

            const onlineInstance = new OnlineInstance({
                instanceKey: instanceDetails.name,
                number: instanceDetails.number,
                token: instanceDetails.token,
                sessionData: {
                    startTime: new Date(),
                    totalInteractions: 0,
                    successfulInteractions: 0
                }
            });

            await onlineInstance.save();
            console.log(`[P2P] Instância ${instanceKey} está online`);
            return true;
        } catch (error) {
            console.error('[P2P] Erro ao iniciar P2P:', error);
            throw error;
        }
    }

    async pauseP2P(instanceKey) {
        try {
            const instance = await OnlineInstance.findOne({ instanceKey });
            if (!instance) {
                console.log('[P2P] Instância não encontrada para pausar:', instanceKey);
                return false;
            }

            // Preservar dados da sessão e remover da lista de online
            const sessionData = instance.sessionData;
            await OnlineInstance.deleteOne({ instanceKey });

            console.log(`[P2P] Instância ${instanceKey} pausada com sucesso`);
            return sessionData;
        } catch (error) {
            console.error('[P2P] Erro ao pausar P2P:', error);
            throw error;
        }
    }

    async stopP2P(instanceKey) {
        try {
            await OnlineInstance.deleteOne({ instanceKey });
            console.log(`[P2P] Instância ${instanceKey} removida completamente`);
            return true;
        } catch (error) {
            console.error('[P2P] Erro ao parar P2P:', error);
            throw error;
        }
    }

    async updateLastSeen(instanceKey) {
        try {
            await OnlineInstance.updateOne(
                { instanceKey },
                { lastSeen: new Date() }
            );
        } catch (error) {
            console.error('[P2P] Erro ao atualizar lastSeen:', error);
        }
    }

    async cleanupOfflineInstances() {
        try {
            const cutoffTime = new Date(Date.now() - this.OFFLINE_THRESHOLD);
            const result = await OnlineInstance.deleteMany({
                lastSeen: { $lt: cutoffTime }
            });
            
            if (result.deletedCount > 0) {
                console.log(`[P2P] Removidas ${result.deletedCount} instâncias offline`);
            }
        } catch (error) {
            console.error('[P2P] Erro na limpeza de instâncias offline:', error);
        }
    }

    async processP2PInteractions() {
        try {
            const onlineInstances = await OnlineInstance.find({
                lastSeen: { $gte: new Date(Date.now() - this.OFFLINE_THRESHOLD) }
            });

            if (onlineInstances.length < 2) {
                console.log('[P2P] Instâncias insuficientes para interação P2P');
                return;
            }

            // Criar pares aleatórios para interação
            const pairs = this.createRandomPairs(onlineInstances);
            
            for (const pair of pairs) {
                await this.performP2PInteraction(pair[0], pair[1]);
            }
        } catch (error) {
            console.error('[P2P] Erro no processamento de interações:', error);
        }
    }

    createRandomPairs(instances) {
        const shuffled = [...instances].sort(() => Math.random() - 0.5);
        const pairs = [];
        
        for (let i = 0; i < shuffled.length - 1; i += 2) {
            pairs.push([shuffled[i], shuffled[i + 1]]);
        }
        
        return pairs;
    }

    async performP2PInteraction(instance1, instance2) {
        try {
            // Aqui você implementaria a lógica real de interação
            // Por exemplo, enviar mensagens entre as instâncias
            console.log(`[P2P] Interação entre ${instance1.number} e ${instance2.number}`);

            // Atualizar estatísticas
            await Promise.all([
                OnlineInstance.updateOne(
                    { instanceKey: instance1.instanceKey },
                    { 
                        $inc: {
                            'sessionData.totalInteractions': 1,
                            'sessionData.successfulInteractions': 1
                        }
                    }
                ),
                OnlineInstance.updateOne(
                    { instanceKey: instance2.instanceKey },
                    { 
                        $inc: {
                            'sessionData.totalInteractions': 1,
                            'sessionData.successfulInteractions': 1
                        }
                    }
                )
            ]);

            return true;
        } catch (error) {
            console.error('[P2P] Erro na interação P2P:', error);
            return false;
        }
    }

    async getOnlineInstancesCount() {
        try {
            return await OnlineInstance.countDocuments({
                lastSeen: { $gte: new Date(Date.now() - this.OFFLINE_THRESHOLD) }
            });
        } catch (error) {
            console.error('[P2P] Erro ao contar instâncias online:', error);
            return 0;
        }
    }

    async getInstanceStats(instanceKey) {
        try {
            const instance = await OnlineInstance.findOne({ instanceKey });
            if (!instance) return null;

            return {
                onlineSince: instance.sessionData.startTime,
                totalInteractions: instance.sessionData.totalInteractions,
                successfulInteractions: instance.sessionData.successfulInteractions,
                successRate: instance.sessionData.totalInteractions > 0 
                    ? (instance.sessionData.successfulInteractions / instance.sessionData.totalInteractions) * 100 
                    : 0
            };
        } catch (error) {
            console.error('[P2P] Erro ao buscar estatísticas:', error);
            return null;
        }
    }
}

module.exports = new P2PService();