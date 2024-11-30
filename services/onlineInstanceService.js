// services/onlineInstanceService.js
const OnlineInstance = require('../models/OnlineInstance');
const axios = require('axios');
const RedisTimerService = require('./redisTimerService');
const eventBus = require('../Helpers/eventBus');
const MaturationSession = require('../models/MaturationSession');

class OnlineInstanceService {
    constructor() {
        this.API_BASE_URL = process.env.API_BASE_URL || 'https://api.hocketzap.com';
        this.CLEANUP_INTERVAL = 5 * 60 * 1000;
        this.OFFLINE_THRESHOLD = 10 * 60 * 1000;
        this.INTERACTION_INTERVAL = 10 * 60 * 1000;
        this.lastInteractions = new Map();
        this.processingInterval = null;
    }

    async registerActivity(sessionId, type, details) {
        const session = await MaturationSession.findById(sessionId);
        if (!session) return;

        session.activities.push({
            type,
            details,
            timestamp: new Date()
        });

        if (details.success) {
            session.progress.successfulInteractions++;
        }

        session.lastActivity = new Date();
        await session.updateProgress();
        await session.save();

        // Emite evento para atualizar frontend
        eventBus.emit('maturation:activity', {
            sessionId,
            activity: session.activities[session.activities.length - 1]
        });
    }

    async initialize() {
        try {
            console.log('[OnlineInstance] Iniciando serviço...');
            
            // Limpa instâncias inativas
            await this.cleanupOfflineInstances();
            
            // Inicia limpeza automática
            setInterval(() => this.cleanupOfflineInstances(), this.CLEANUP_INTERVAL);
            
            // Inicia atualização periódica de status
            setInterval(() => this.updateOnlineStatus(), 60000); // A cada minuto
            
            console.log('[OnlineInstance] Serviço iniciado com sucesso');
        } catch (error) {
            console.error('[OnlineInstance] Erro na inicialização:', error);
            throw error;
        }
    }

    async cleanup() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    async getNextActionFormatted(instanceKey) {
        const nextAction = await this.getNextAction(instanceKey);
        if (!nextAction) return 'Aguardando...';
        
        const now = Date.now();
        const remaining = nextAction - now;
        
        if (remaining <= 0) return 'Processando...';
        
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    async processInteractions(session) {
        try {
            const onlineInstances = await this.getOnlineInstances();
            if (onlineInstances.length < 2) {
                console.log('[P2P] Aguardando mais instâncias ficarem online...');
                return;
            }
    
            console.log(`[P2P] Processando interações entre ${onlineInstances.length} instâncias`);
    
            const now = Date.now();
            const pairs = this.createRandomPairs(onlineInstances); // Cria os pares
    
            // Para cada par, tenta realizar a interação
            for (const [instance1, instance2] of pairs) {
                try {
                    console.log(`[P2P] Tentando interação entre ${instance1.instanceKey} e ${instance2.instanceKey}`);
                    
                    // Obtém detalhes das instâncias
                    const details1 = await this.getInstanceDetails(instance1.instanceKey);
                    const details2 = await this.getInstanceDetails(instance2.instanceKey);
                    console.log(details1);
                    console.log(details2);
    
                    if (!details1 || !details2) {
                        console.log('[P2P] Uma das instâncias não tem detalhes válidos');
                        continue;
                    }
    
                    // Tenta realizar a interação
                    const success = await this.sendP2PMessage(details1, details2, session);
                    
                    if (success) {
                        // Atualiza estatísticas e próxima ação
                        await this.updateInteractionStats(instance1);
                        await this.updateInteractionStats(instance2);
                        
                        const nextAction = now + this.INTERACTION_INTERVAL;
                        await RedisTimerService.saveTimer(instance1.instanceKey, nextAction);
                        await RedisTimerService.saveTimer(instance2.instanceKey, nextAction);
                        
                        this.lastInteractions.set(instance1.instanceKey, now);
                        this.lastInteractions.set(instance2.instanceKey, now);
                        
                        console.log(`[P2P] Interação realizada com sucesso entre ${instance1.instanceKey} e ${instance2.instanceKey}`);
                    }
                } catch (interactionError) {
                    console.error(`[P2P] Erro na interação específica:`, interactionError);
                }
            }
        } catch (error) {
            console.error('[P2P] Erro ao processar interações:', error);
        }
    }

async sendP2PMessage(sender, receiver, session) {
    try {
        const { sendTextMessage } = require('./funnelExecutor');
        console.log("funcao d msg chamada")
        const message = this.generateMessage();
        console.log(message)
console.log("Enviando msg")
        await sendTextMessage(
            sender.name,
            message,
            1,
            receiver.number + "@s.whatsapp.net"
        );

  
            await this.registerActivity(session._id, 'p2p_communication', {
                type: 'message_sent',
                success: true,
                targetInstance: receiver.name,
                targetNumber: receiver.number,
                messageContent: message
            });

  

        console.log(`[P2P] Mensagem enviada de ${sender.name} para ${receiver.number}`);
        return true;
    } catch (error) {
        console.error('[P2P] Erro ao enviar mensagem:', error);
        return false;
    }
}

generateMessage() {
    const messages = [
        "Oi, tudo bem?",
        "Como vai você?",
        "Boa tarde!",
        "Olá, como está?",
        "Oi, posso te fazer uma pergunta?",
        "Oi, você pode me ajudar?",
        "Tudo tranquilo?",
        "Oi, desculpe incomodar",
        "Oi, você está online?",
        "Olá, podemos conversar?"
    ];
    return messages[Math.floor(Math.random() * messages.length)];
}

createRandomPairs(instances) {
    const shuffled = [...instances].sort(() => Math.random() - 0.5); // Embaralha as instâncias
    const pairs = [];
    
    // Cria pares enquanto houverem pelo menos 2 instâncias
    while (shuffled.length > 1) {
        const instance1 = shuffled.pop(); // Remove o último elemento
        const instance2 = shuffled.pop(); // Remove o novo último elemento
        pairs.push([instance1, instance2]); // Cria o par
    }
console.log("pares:", pairs)
    return pairs;
}

    async performInteraction(instance1, instance2) {
        try {
            const details1 = await this.getInstanceDetails(instance1.instanceKey);
            const details2 = await this.getInstanceDetails(instance2.instanceKey);
    
            if (!details1 || !details2) {
                throw new Error('Detalhes das instâncias não disponíveis');
            }
    
            // Envia mensagem em ambas as direções
            const success1 = await this.sendP2PMessage(details1, details2);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos entre mensagens
            const success2 = await this.sendP2PMessage(details2, details1);
    
            const success = success1 || success2;
            if (success) {
                // Atualiza estatísticas
                const now = Date.now();
                const nextAction = now + this.INTERACTION_INTERVAL;
                
                await Promise.all([
                    this.updateInteractionStats(instance1),
                    this.updateInteractionStats(instance2),
                    RedisTimerService.saveTimer(instance1.instanceKey, nextAction),
                    RedisTimerService.saveTimer(instance2.instanceKey, nextAction)
                ]);
    
                console.log(`[P2P] Interação completa entre ${instance1.instanceKey} e ${instance2.instanceKey}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[P2P] Erro na interação:', error);
            return false;
        }
    }
    

    async updateInteractionStats(instance) {
        try {
            const now = new Date();
            
            // Atualiza instância no banco
            await OnlineInstance.updateOne(
                { instanceKey: instance.instanceKey },
                {
                    $inc: {
                        'sessionData.totalInteractions': 1,
                        'sessionData.successfulInteractions': 1
                    },
                    $set: {
                        lastSeen: now,
                        'sessionData.lastInteraction': now
                    }
                }
            );
    
            console.log(`[P2P] Estatísticas atualizadas para ${instance.instanceKey}`);
        } catch (error) {
            console.error('[P2P] Erro ao atualizar estatísticas:', error);
        }
    }

    async getNextAction(instanceKey) {
        try {
            const timestamp = await RedisTimerService.getTimer(instanceKey);
            if (!timestamp) {
                const nextAction = Date.now() + this.INTERACTION_INTERVAL;
                await RedisTimerService.saveTimer(instanceKey, nextAction);
                return nextAction;
            }
            return parseInt(timestamp);
        } catch (error) {
            console.error('[OnlineInstance] Erro ao obter próxima ação:', error);
            return null;
        }
    }


    async getInstanceDetails(instanceKey) {
        try {
            const response = await axios.get(
                `${this.API_BASE_URL}/instance/fetchInstances`,
                { headers: { apikey: 'darkadm' } }
            );

            const instance = response.data.find(inst => inst.name === instanceKey);
            if (!instance || !instance.number) {
                console.log('[OnlineInstance] Instância sem número:', instanceKey);
                return null;
            }

            return {
                name: instance.name,
                number: instance.number.replace(/\D/g, ''),
                token: instance.name
            };
        } catch (error) {
            console.error('[OnlineInstance] Erro ao buscar detalhes:', error);
            return null;
        }
    }

    async addInstance(instanceKey, session) {
        try {
            const instanceDetails = await this.getInstanceDetails(instanceKey);
            if (!instanceDetails) {
                throw new Error('Não foi possível obter detalhes da instância');
            }
    
            let instance = await OnlineInstance.findOne({ instanceKey });
    
            if (instance) {
                // Atualiza instance existente
                instance.lastSeen = new Date();
                instance.number = instanceDetails.number;
                instance.sessionData = {
                    ...instance.sessionData,
                    totalInteractions: instance.sessionData?.totalInteractions || 0,
                    successfulInteractions: instance.sessionData?.successfulInteractions || 0,
                    lastInteraction: new Date()
                };
                await instance.save();
            } else {
                // Cria nova instance
                instance = new OnlineInstance({
                    instanceKey: instanceDetails.name,
                    number: instanceDetails.number,
                    token: instanceDetails.token,
                    sessionData: {
                        startTime: new Date(),
                        totalInteractions: 0,
                        successfulInteractions: 0,
                        lastInteraction: new Date()
                    }
                });
                await instance.save();
            }
    
            // Define próxima ação
            const nextAction = Date.now() + this.INTERACTION_INTERVAL;
            await RedisTimerService.saveTimer(instanceKey, nextAction);
            
            // Atualiza controle de interações
            this.lastInteractions.set(instanceKey, Date.now());
    
            // Inicia processamento de interações se não estiver rodando
            if (!this.processingInterval) {
                this.startProcessingInterval(session);
            }
    
            console.log(`[OnlineInstance] Instância ${instanceKey} está online, próxima ação em ${this.INTERACTION_INTERVAL/1000}s`);
            return instance;
        } catch (error) {
            console.error('[OnlineInstance] Erro ao adicionar instância:', error);
            throw error;
        }
    }

    startProcessingInterval(session) {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
        }
    
        this.processingInterval = setInterval(async () => {
            await this.processInteractions(session);
        }, Math.floor(this.INTERACTION_INTERVAL / 2)); // Checagem mais frequente que o intervalo
    }

    async removeInstance(instanceKey, removeData = false) {
        try {
            if (removeData) {
                // Remove completamente a instância
                await OnlineInstance.deleteOne({ instanceKey });
            } else {
                // Apenas marca como offline mantendo os dados
                const instance = await OnlineInstance.findOne({ instanceKey });
                if (instance) {
                    instance.lastSeen = new Date(0); // Marca como offline
                    await instance.save();
                }
            }

            // Emite evento de atualização
            eventBus.emit('onlineInstances:updated');
            
            console.log(`[OnlineInstance] Instância ${instanceKey} removida ${removeData ? 'completamente' : 'da lista de online'}`);
            return true;
        } catch (error) {
            console.error('[OnlineInstance] Erro ao remover instância:', error);
            throw error;
        }
    }

    async getOnlineInstances() {
        try {
            const cutoffTime = new Date(Date.now() - this.OFFLINE_THRESHOLD);
            return await OnlineInstance.find({
                lastSeen: { $gte: cutoffTime }
            }).select('-__v');
        } catch (error) {
            console.error('[OnlineInstance] Erro ao buscar instâncias online:', error);
            return [];
        }
    }

    async getOnlineCount() {
        try {
            const cutoffTime = new Date(Date.now() - this.OFFLINE_THRESHOLD);
            return await OnlineInstance.countDocuments({
                lastSeen: { $gte: cutoffTime }
            });
        } catch (error) {
            console.error('[OnlineInstance] Erro ao contar instâncias online:', error);
            return 0;
        }
    }

    async updateInstanceStatus(instanceKey) {
        try {
            const instance = await OnlineInstance.findOne({ instanceKey });
            if (instance) {
                instance.lastSeen = new Date();
                await instance.save();
                return true;
            }
            return false;
        } catch (error) {
            console.error('[OnlineInstance] Erro ao atualizar status:', error);
            return false;
        }
    }

    async cleanupOfflineInstances() {
        try {
            const cutoffTime = new Date(Date.now() - this.OFFLINE_THRESHOLD);
            const result = await OnlineInstance.updateMany(
                { lastSeen: { $lt: cutoffTime } },
                { 
                    $set: { 
                        lastSeen: new Date(0),
                        'sessionData.endTime': new Date()
                    }
                }
            );
            
            if (result.modifiedCount > 0) {
                console.log(`[OnlineInstance] ${result.modifiedCount} instâncias marcadas como offline`);
                eventBus.emit('onlineInstances:updated');
            }
        } catch (error) {
            console.error('[OnlineInstance] Erro na limpeza de instâncias:', error);
        }
    }

    async updateOnlineStatus() {
        try {
            const instances = await this.getOnlineInstances();
            for (const instance of instances) {
                const details = await this.getInstanceDetails(instance.instanceKey);
                if (!details) {
                    await this.removeInstance(instance.instanceKey);
                }
            }
            eventBus.emit('onlineInstances:updated');
        } catch (error) {
            console.error('[OnlineInstance] Erro ao atualizar status online:', error);
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
                    : 0,
                lastSeen: instance.lastSeen,
                isOnline: instance.lastSeen > new Date(Date.now() - this.OFFLINE_THRESHOLD)
            };
        } catch (error) {
            console.error('[OnlineInstance] Erro ao buscar estatísticas:', error);
            return null;
        }
    }

    async syncWithInstances(instanceKeys, session) {
        try {
            // Remove instâncias que não estão mais na lista
            await OnlineInstance.deleteMany({
                instanceKey: { $nin: instanceKeys }
            });

            // Adiciona ou atualiza instâncias da lista
            for (const key of instanceKeys) {
                await this.addInstance(key, session);
            }

            eventBus.emit('onlineInstances:updated');
        } catch (error) {
            console.error('[OnlineInstance] Erro ao sincronizar instâncias:', error);
        }
    }
}

module.exports = new OnlineInstanceService();