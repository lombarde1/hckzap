const MaturationSession = require('../models/MaturationSession');
const GroupScrapper = require('./GroupScrapper');
const { sendTextMessage } = require('./funnelExecutor');
const redisClient = require('../config/redisConfig');
const eventBus = require('../Helpers/eventBus');

const OnlineInstanceService = require('./onlineInstanceService');
const RedisTimerService = require('./redisTimerService');
const axios = require("axios")
const User = require('../models/User');
const API_BASE_URL = 'https://api.hocketzap.com';


class P2PCommunicationManager {
    constructor(service) {
        this.service = service;
        this.onlineUsers = new Set();
        this.connectionCheckers = new Map();
        this.initialized = false;
    }

    async start(session) {
        try {
            console.log(`[P2P] Iniciando comunicação para sessão ${session._id}`);

            if (!this.initialized) {
                await this.initialize();
            }

            // Adiciona à lista de usuários online
            this.onlineUsers.add(session.instanceKey);
            
            // Atualiza status
            session.methods.p2pCommunication.onlineStatus = true;
            session.methods.p2pCommunication.lastConnection = new Date();
            await session.save();

            // Inicia verificação periódica
            this.startConnectionChecker(session);

            // Inicia ciclo de comunicação
             this.startCommunicationCycle(session);

            console.log(`[P2P] Comunicação iniciada. Usuários online: ${this.onlineUsers.size}`);
            return true;
        } catch (error) {
            console.error('[P2P] Erro ao iniciar comunicação:', error);
            throw error;
        }
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            console.log('[P2P] Iniciando sistema P2P...');
            
            // Restaura sessões ativas do banco de dados
            const activeSessions = await MaturationSession.find({
                status: 'active',
                'methods.p2pCommunication.enabled': true,
                'methods.p2pCommunication.onlineStatus': true
            });

            console.log(`[P2P] Encontradas ${activeSessions.length} sessões para restaurar`);

            // Restaura cada sessão
            for (const session of activeSessions) {
                try {
                    await this.restoreSession(session);
                } catch (error) {
                    console.error(`[P2P] Erro ao restaurar sessão ${session._id}:`, error);
                }
            }

            // Inicia monitoramento periódico
            this.startPeriodicCheck();
            
            this.initialized = true;
            console.log('[P2P] Sistema inicializado com sucesso');
        } catch (error) {
            console.error('[P2P] Erro ao inicializar sistema:', error);
            throw error;
        }
    }

    async restoreSession(session) {
        console.log(`[P2P] Restaurando sessão ${session._id}`);
        
        // Verifica se a instância ainda existe na API
        const instanceDetails = await this.getInstanceDetails(session.instanceKey);
        if (!instanceDetails) {
            console.log(`[P2P] Instância ${session.instanceKey} não encontrada, desativando...`);
            await this.deactivateSession(session);
            return;
        }

        // Adiciona à lista de usuários online
        this.onlineUsers.add(session.instanceKey);
        
        // Restaura timer do Redis
        const nextAction = await RedisTimerService.getTimer(session._id.toString());
        if (!nextAction) {
            const newNextAction = Date.now() + this.calculateInterval();
            await RedisTimerService.saveTimer(session._id.toString(), newNextAction);
            session.nextScheduledAction = new Date(newNextAction);
        } else {
            session.nextScheduledAction = new Date(parseInt(nextAction));
        }

        await session.save();

        // Inicia conexão checker
        this.startConnectionChecker(session);
        
        // Inicia ciclo de comunicação
        await this.startCommunicationCycle(session);
        
        console.log(`[P2P] Sessão ${session._id} restaurada com sucesso`);
    }

    async deactivateSession(session) {
        session.methods.p2pCommunication.onlineStatus = false;
        session.status = 'paused';
        await session.save();
    }

    startConnectionChecker(session) {
        const checker = setInterval(async () => {
            try {
                const currentSession = await MaturationSession.findById(session._id);
                if (!currentSession || currentSession.status !== 'active') {
                    this.stopConnectionChecker(session._id.toString());
                    return;
                }

                currentSession.methods.p2pCommunication.lastConnection = new Date();
                await currentSession.save();
            } catch (error) {
                console.error('[P2P] Erro no checker:', error);
                this.stopConnectionChecker(session._id.toString());
            }
        }, 30000);

        this.connectionCheckers.set(session._id.toString(), checker);
    }

    stopConnectionChecker(sessionId) {
        const checker = this.connectionCheckers.get(sessionId);
        if (checker) {
            clearInterval(checker);
            this.connectionCheckers.delete(sessionId);
        }
    }

    startPeriodicCheck() {
        setInterval(async () => {
            try {
                // Verifica e sincroniza estados
                const activeSessions = await MaturationSession.find({
                    status: 'active',
                    'methods.p2pCommunication.enabled': true,
                    'methods.p2pCommunication.onlineStatus': true
                });

                // Atualiza lista de online
                this.onlineUsers.clear();
                for (const session of activeSessions) {
                    this.onlineUsers.add(session.instanceKey);
                }

                // Verifica cada sessão
                for (const session of activeSessions) {
                    const nextAction = await RedisTimerService.getTimer(session._id.toString());
                    if (!nextAction || new Date(parseInt(nextAction)) < new Date()) {
                        console.log(`[P2P] Reiniciando ciclo para sessão ${session._id}`);
                        await this.startCommunicationCycle(session);
                    }
                }

                console.log(`[P2P] Check periódico: ${this.onlineUsers.size} usuários online`);
            } catch (error) {
                console.error('[P2P] Erro no check periódico:', error);
            }
        }, 30000); // A cada 30 segundos
    }

    async startCommunicationCycle(session) {
        try {
            const currentSession = await MaturationSession.findById(session._id);
            if (!currentSession || currentSession.status !== 'active') {
                console.log(`[P2P] Sessão ${session._id} não está mais ativa`);
                return;
            }

            const onlineInstances = Array.from(this.onlineUsers)
                .filter(instance => instance !== session.instanceKey);

            if (onlineInstances.length === 0) {
                console.log('[P2P] Aguardando outras instâncias ficarem online...');
                await this.scheduleNextAction(session, 60000);
                return;
            }

            // Tenta encontrar uma instância válida
            let validTarget = null;
            for (const targetKey of onlineInstances) {
                const targetDetails = await this.getInstanceDetails(targetKey);
                if (targetDetails) {
                    validTarget = targetDetails;
                    break;
                }
            }

            if (!validTarget) {
                console.log('[P2P] Nenhuma instância válida encontrada');
                await this.scheduleNextAction(session, 60000);
                return;
            }

            // Envia mensagem
            await this.sendMessage(session, validTarget);
            
            // Agenda próxima ação
            await this.scheduleNextAction(session);

        } catch (error) {
            console.error('[P2P] Erro no ciclo de comunicação:', error);
            await this.scheduleNextAction(session, 60000);
        }
    }


    async getOtherOnlineInstances(currentKey) {
        return Array.from(this.onlineUsers).filter(key => key !== currentKey);
    }

    async getInstanceDetails(instanceKey) {
        try {
            const response = await axios.get(
                `${API_BASE_URL}/instance/fetchInstances`,
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

    async sendMessage(session, target) {
        try {
            const message = this.generateMessage();
            
            await sendTextMessage(
                session.instanceKey,
                message,
                1000,
                target.number
            );

            await this.service.registerActivity(session._id, 'p2p_communication', {
                type: 'message_sent',
                success: true,
                targetInstance: target.name,
                targetNumber: target.number,
                messageContent: message
            });

            console.log(`[P2P] Mensagem enviada para ${target.number}`);
        } catch (error) {
            console.error('[P2P] Erro ao enviar mensagem:', error);
            throw error;
        }
    }

    async scheduleNextCycle(session, customInterval = null) {
        try {
            const interval = customInterval || this.calculateInterval();
            const nextAction = Date.now() + interval;

            // Salva próxima ação
            session.nextScheduledAction = new Date(nextAction);
            await session.save();
            await RedisTimerService.saveTimer(session._id.toString(), nextAction);

            // Agenda próximo ciclo
            setTimeout(() => {
                this.startCommunicationCycle(session).catch(error => {
                    console.error('[P2P] Erro ao iniciar próximo ciclo:', error);
                });
            }, interval);

            console.log(`[P2P] Próximo ciclo em ${interval / 1000} segundos`);
        } catch (error) {
            console.error('[P2P] Erro ao agendar próximo ciclo:', error);
        }
    }

    async scheduleNextAction(session, customInterval = null) {
        const interval = customInterval || this.calculateInterval();
        const nextAction = Date.now() + interval;

        session.nextScheduledAction = new Date(nextAction);
        await session.save();
        await RedisTimerService.saveTimer(session._id.toString(), nextAction);

        setTimeout(() => {
            this.startCommunicationCycle(session).catch(console.error);
        }, interval);

        console.log(`[P2P] Próxima ação para ${session._id} em ${interval/1000}s`);
    }

    async stop(session) {
        try {
            console.log(`[P2P] Parando comunicação para sessão ${session._id}`);
            
            this.onlineUsers.delete(session.instanceKey);
            this.stopConnectionChecker(session._id.toString());
            
            session.methods.p2pCommunication.onlineStatus = false;
            await session.save();
            
            console.log(`[P2P] Comunicação parada. Usuários online: ${this.onlineUsers.size}`);
        } catch (error) {
            console.error('[P2P] Erro ao parar comunicação:', error);
        }
    }

    calculateInterval() {
        const minInterval = 60 * 1000; // 1 minuto
        const maxInterval = 120 * 1000; // 2 minutos
        return Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
    }

    generateMessage() {
        const messages = [
            "Oi, tudo bem?",
            "Como vai você?",
            "Boa tarde, tudo bem?",
            "Olá, como está?",
            "Oi, posso te perguntar algo?",
            "Oi, você pode me ajudar?",
            "Tudo tranquilo?",
            "Oi, desculpe incomodar",
            "Olá, podemos conversar?",
            "Oi, tem um minuto?"
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    }
}

class MaturationService {
    constructor() {
      this.activeSessions = new Map();
      this.onlineUsers = new Set();
      this.messageQueue = new Map();
      this.executionTimers = new Map(); // Novo: Mapa para controlar os timers de execução
      this.p2pManager = new P2PCommunicationManager(this);
    }

    async startSession(userId, instanceKey, config) {
        try {
            const session = new MaturationSession({
                userId,
                instanceKey,
                nextScheduledAction: new Date(Date.now() + this.calculateNextInterval()),
                methods: {
                    groupOwnerInteraction: {
                        enabled: config.methods.includes('ownerInteraction'),
                        dailyLimit: 50,
                        currentCount: 0
                    },
                    p2pCommunication: {
                        enabled: config.methods.includes('p2pCommunication'),
                        onlineStatus: false
                    }
                },
                configuration: {
                    durationDays: config.durationDays,
                    startDate: new Date(),
                    endDate: new Date(Date.now() + (config.durationDays * 24 * 60 * 60 * 1000))
                }
            });

            await session.save();
            this.activeSessions.set(instanceKey, session);

            if (session.methods.groupOwnerInteraction.enabled) {
                await this.startOwnerInteraction(session);
            }

            if (session.methods.p2pCommunication.enabled) {
                await OnlineInstanceService.addInstance(instanceKey, session);
            }

            return session;
        } catch (error) {
            console.error('Error starting maturation session:', error);
            throw error;
        }
    }
    
 async  calculateProgress(session) {
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

    // Cálculo baseado no tempo decorrido e ações realizadas
    const totalTimeInMs = end.getTime() - start.getTime();
    const elapsedTimeInMs = now.getTime() - start.getTime();
    const timeProgress = (elapsedTimeInMs / totalTimeInMs) * 100;

    // Cálculo baseado nas ações (se tiver um limite diário)
    let actionsProgress = 0;
    if (session.methods.groupOwnerInteraction.enabled) {
        const totalExpectedActions = session.methods.groupOwnerInteraction.dailyLimit * 
                                   session.configuration.durationDays;
        const completedActions = session.activities ? session.activities.length : 0;
        actionsProgress = (completedActions / totalExpectedActions) * 100;
    }

    // Média entre progresso de tempo e ações
    const totalProgress = (timeProgress + actionsProgress) / 2;
    return Math.min(Math.round(totalProgress), 100);
}

  // Adicione este método na classe MaturationService
// No MaturationController
async getAllActiveSessions() {
    try {
        const sessions = await MaturationSession.find({
            status: { $in: ['active', 'paused'] }
        }).populate('userId', 'name email');

        const onlineInstances = await OnlineInstanceService.getOnlineInstances();

        return Promise.all(sessions.map(async (session) => {
            const nextAction = await OnlineInstanceService.getNextAction(session.instanceKey);
            const isOnline = onlineInstances.some(inst => inst.instanceKey === session.instanceKey);

            return {
                id: session._id,
                instanceKey: session.instanceKey,
                user: session.userId,
                startDate: session.configuration.startDate,
                progress: await this.calculateProgress(session),
                stats: {
                    interactions: {
                        total: session.activities.length,
                        successful: session.activities.filter(a => a.details?.success).length
                    }
                },
                methods: session.methods,
                status: session.status,
                configuration: session.configuration,
                activities: session.activities.slice(-5),
                nextScheduledAction: nextAction ? new Date(nextAction) : null,
                isOnline
            };
        }));
    } catch (error) {
        console.error('Error getting active sessions:', error);
        throw error;
    }
}

async getSessionHistory(page = 1, limit = 10) {
    return RedisTimerService.getHistory(page, limit);
}

async pauseSession(sessionId) {
    try {
        const session = await MaturationSession.findById(sessionId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        // Limpa timers existentes
        this.clearSessionTimers(session._id.toString());

        if (session.methods.p2pCommunication.enabled) {
            await OnlineInstanceService.removeInstance(session.instanceKey);
        }

        session.status = 'paused';
        session.methods.p2pCommunication.onlineStatus = false;
        await session.save();

        if (this.activeSessions.has(session.instanceKey)) {
            const existingSession = this.activeSessions.get(session.instanceKey);
            existingSession.status = 'paused';
        }

        await RedisTimerService.addToHistory(session);

        return true;
    } catch (error) {
        console.error('Error pausing session:', error);
        throw error;
    }
}


  clearSessionTimers(sessionId) {
    const timers = this.executionTimers.get(sessionId) || [];
    timers.forEach(timer => clearTimeout(timer));
    this.executionTimers.delete(sessionId);
  }

  async resumeSession(sessionId) {
    try {
        const session = await MaturationSession.findById(sessionId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        this.clearSessionTimers(session._id.toString());

        session.status = 'active';
        await session.save();

        this.activeSessions.set(session.instanceKey, session);

        if (session.methods.groupOwnerInteraction.enabled) {
            await this.startOwnerInteraction(session);
        }

        if (session.methods.p2pCommunication.enabled) {
            await OnlineInstanceService.addInstance(session.instanceKey);
        }

        return true;
    } catch (error) {
        console.error('Error resuming session:', error);
        throw error;
    }
}



async stopSession(sessionId) {
    try {
        const session = await MaturationSession.findById(sessionId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (session.methods.p2pCommunication.enabled) {
            await OnlineInstanceService.removeInstance(session.instanceKey, true);
        }

        this.clearSessionTimers(session._id.toString());
        this.activeSessions.delete(session.instanceKey);

        await MaturationSession.findByIdAndDelete(sessionId);
        await RedisTimerService.removeTimer(sessionId);

        const autoResponseKey = `auto_response:${session.instanceKey}:*`;
        const keys = await redisClient.keys(autoResponseKey);
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
        
        return true;
    } catch (error) {
        console.error('Error stopping session:', error);
        throw error;
    }
}






async executeInteractionCycle(session) {
    // Verifica se a sessão está ativa antes de executar
    const currentSession = await MaturationSession.findById(session._id);
    if (!currentSession || currentSession.status !== 'active') {
      console.log(`Sessão ${session._id} não está ativa. Interrompendo ciclo.`);
      return;
    }

    try {
      console.log(`Iniciando novo ciclo de interação para sessão ${session._id}`);

      if (!session.checkLimits()) {
        console.log('Limites atingidos');
        return;
      }

        let validGroup = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (!validGroup && attempts < maxAttempts) {
            attempts++;
            console.log(`Tentativa ${attempts} de encontrar novo grupo`);

            const groups = await GroupScrapper.start(session.instanceKey, 1);
            
            if (groups && groups.length > 0) {
                validGroup = groups[0];
                break;
            }

            console.log('Tentativa falhou, aguardando antes da próxima...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        if (validGroup) {
            try {
                console.log(`Iniciando interação com novo grupo: ${validGroup.subject}`);
                const success = await this.executeOwnerInteraction(session, validGroup);

                if (success) {
                    
                    console.log('Interação concluída com sucesso');
                     // Registra atividade bem-sucedida
                     session.activities.push({
                        type: 'owner_message',
                        details: {
                            groupName: validGroup.subject,
                            ownerNumber: validGroup.owner,
                            success: true,
                            timestamp: new Date()
                        }
                    });

                    session.methods.groupOwnerInteraction.currentCount++;
                    await session.updateProgress();
                    await session.save();
                    await session.updateProgress();
                }

                
            } catch (error) {
                console.error('Erro na interação:', error);
            }
        }

        // Agenda próximo ciclo se a sessão ainda estiver ativa
        const activeSession = await this.getActiveSessionByInstance(session.instanceKey);
        if (activeSession?.status === 'active') {
          const interval = this.calculateNextInterval();
          console.log(`Agendando próximo ciclo para ${interval}ms`);
          
          const timer = setTimeout(() => {
            this.executeInteractionCycle(activeSession).catch(console.error);
          }, interval);
  
          // Armazena o timer para poder cancelá-lo depois se necessário
          const timers = this.executionTimers.get(session._id.toString()) || [];
          timers.push(timer);
          this.executionTimers.set(session._id.toString(), timers);
        }
  
      } catch (error) {
        console.error('Erro no ciclo de interação:', error);
      }
    
}

// Atualiza o método startOwnerInteraction para usar o novo ciclo

async startOwnerInteraction(session) {
    if (!session || session.status !== 'active') {
      console.log('Sessão inválida ou inativa');
      return;
    }

    // Limpa timers antigos antes de iniciar novo ciclo
    this.clearSessionTimers(session._id.toString());

    // Inicia o primeiro ciclo
    await this.executeInteractionCycle(session);
  }

  async monitorActiveSessions() {
    try {
      const activeSessions = await this.getAllActiveSessions();
      
      for (const session of activeSessions) {
        // Verifica se a próxima ação está atrasada
        if (session.nextScheduledAction && new Date(session.nextScheduledAction) < new Date()) {
          console.log(`Sessão ${session._id} está atrasada, reiniciando ciclo...`);
          
          // Reinicia o ciclo de interação
          this.startOwnerInteraction(session);
        }
        
        // Verifica se a sessão está ativa mas sem atividades recentes
        const lastActivity = session.activities[session.activities.length - 1];
        if (lastActivity) {
          const inactiveTime = Date.now() - new Date(lastActivity.timestamp).getTime();
          const maxInactiveTime = 30 * 60 * 1000; // 30 minutos
          
          if (inactiveTime > maxInactiveTime) {
            console.log(`Sessão ${session._id} inativa por muito tempo, reiniciando...`);
            this.startOwnerInteraction(session);
          }
        }
      }
    } catch (error) {
      console.error('Erro ao monitorar sessões:', error);
    }
  }


  async executeOwnerInteraction(session, group) {
    try {
        const ownerNumber = group.owner.split('@')[0];
        const messages = [
            {
                content: `Oi você que é o dono do grupo "${group.subject}"??`,
                delay: 0
            },
            {
                content: "Tem um cara aqui que está ameaçando os membros de la, so vim te avisar",
                delay: 2000
            }
        ];

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, messages[i].delay));
            }

            await sendTextMessage(
                session.instanceKey,
                message.content,
                0,
                ownerNumber
            );
        }

        // Atualiza próxima ação e salva no Redis
        const nextAction = Date.now() + this.calculateNextInterval();
        session.nextScheduledAction = new Date(nextAction);
        await session.save();
        await RedisTimerService.saveTimer(session._id.toString(), nextAction);

        await redisClient.setex(
            `maturation:waiting_response:${session.instanceKey}:${ownerNumber}`,
            3600,
            'true'
        );

        return true;
    } catch (error) {
        console.error('Erro ao executar interação com dono do grupo:', error);
        throw error;
    }
}

  async handleOwnerResponse(instanceKey, number) {
    const key = `maturation:waiting_response:${instanceKey}:${number}`;
    const isWaiting = await redisClient.get(key);

    if (isWaiting) {
      await sendTextMessage(
        instanceKey,
        "Nao to te conseguindo enviar os prints aqui da ameaça dele, salva meu contato pra eu te enviar, acho que ta bugado",
        1000,
        number
      );
      await redisClient.del(key);
    }
  }

  startPeriodicTasks() {
    console.log('Iniciando tarefas periódicas...');
    
    // Verifica sessões ativas
    setInterval(() => {
        this.checkActiveSessions().catch(error => {
            console.error('Erro ao verificar sessões ativas:', error);
        });
    }, 60000); // a cada minuto

    // Reseta limites diários
    setInterval(() => {
        this.resetDailyLimits().catch(error => {
            console.error('Erro ao resetar limites diários:', error);
        });
    }, 86400000); // a cada 24 horas

    // Monitora sessões
    setInterval(() => {
        this.monitorActiveSessions().catch(error => {
            console.error('Erro ao monitorar sessões:', error);
        });
    }, 60000); // a cada minuto

    console.log('Tarefas periódicas iniciadas');
}

async initialize() {
    try {
        console.log('Inicializando MaturationService...');
        
        await OnlineInstanceService.initialize();
        await this.syncWithDatabase();
        this.startPeriodicTasks();
        
        console.log('MaturationService inicializado com sucesso');
    } catch (error) {
        console.error('Erro na inicialização do MaturationService:', error);
        throw error;
    }
}


async startP2PCommunication(session) {
    try {
        // Verifica se P2P Manager está inicializado
        if (!this.p2pManager.initialized) {
            console.log('Inicializando P2P Manager...');
            await this.p2pManager.initialize();
        }

        return await this.p2pManager.start(session);
    } catch (error) {
        console.error('Erro ao iniciar comunicação P2P:', error);
        throw error;
    }
}


setupShutdownHandlers() {
    const cleanup = async () => {
        console.log('Realizando limpeza antes de encerrar...');
        try {
            // Limpa todos os timers
            for (const [sessionId, timers] of this.executionTimers) {
                timers.forEach(timer => clearTimeout(timer));
            }
            
            // Salva estado das sessões ativas
            const activeSessions = await MaturationSession.find({ status: 'active' });
            for (const session of activeSessions) {
                if (session.nextScheduledAction) {
                    await RedisTimerService.saveTimer(
                        session._id.toString(),
                        session.nextScheduledAction.getTime()
                    );
                }
            }
            
            console.log('Limpeza concluída');
            process.exit(0);
        } catch (error) {
            console.error('Erro durante limpeza:', error);
            process.exit(1);
        }
    };

    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
}

  async schedulePeerCommunication(session) {
    try {
        // Verifica status da sessão
        const currentSession = await MaturationSession.findById(session._id);
        if (!currentSession || currentSession.status !== 'active') {
            console.log(`Sessão ${session._id} não está mais ativa`);
            return;
        }

        // Busca usuários online
        const onlineInstances = Array.from(this.onlineUsers)
            .filter(instance => instance !== session.instanceKey);

        if (onlineInstances.length === 0) {
            console.log('Aguardando outras instâncias ficarem online...');
            
            // Salva próxima tentativa no Redis
            const nextCheck = Date.now() + 60000; // Tenta novamente em 1 minuto
            session.nextScheduledAction = new Date(nextCheck);
            await session.save();
            await RedisTimerService.saveTimer(session._id.toString(), nextCheck);

            // Agenda próxima verificação
            const timer = setTimeout(() => {
                this.schedulePeerCommunication(session).catch(console.error);
            }, 60000);

            const timers = this.executionTimers.get(session._id.toString()) || [];
            timers.push(timer);
            this.executionTimers.set(session._id.toString(), timers);
            
            return;
        }

        try {
            // Seleciona instância aleatória
            const targetInstanceKey = onlineInstances[Math.floor(Math.random() * onlineInstances.length)];
            
            // Busca detalhes da instância na API
            const response = await axios.get(
                `${API_BASE_URL}/instance/fetchInstances`,
                { headers: { apikey: 'darkadm' } }
            );

            const targetInstance = response.data.find(inst => inst.name === targetInstanceKey);

            if (!targetInstance || !targetInstance.number) {
                console.log('Instância alvo sem número válido');
                this.scheduleNextCommunication(session);
                return;
            }

            // Envia mensagem
            const message = this.generateRandomMessage();
            const formattedNumber = targetInstance.number.replace(/\D/g, '');

            await sendTextMessage(
                session.instanceKey,
                message,
                1000,
                formattedNumber
            );

            // Registra atividade
            await this.registerActivity(session._id, 'p2p_communication', {
                type: 'message_sent',
                success: true,
                targetInstance: targetInstance.name,
                targetNumber: formattedNumber,
                messageContent: message
            });

            console.log(`Mensagem P2P enviada para ${formattedNumber}`);

            // Agenda e salva próxima ação
            const nextInterval = this.calculateP2PInterval();
            const nextAction = Date.now() + nextInterval;
            
            session.nextScheduledAction = new Date(nextAction);
            await session.save();
            await RedisTimerService.saveTimer(session._id.toString(), nextAction);

            // Agenda próxima comunicação
            const timer = setTimeout(() => {
                this.schedulePeerCommunication(session).catch(console.error);
            }, nextInterval);

            const timers = this.executionTimers.get(session._id.toString()) || [];
            timers.push(timer);
            this.executionTimers.set(session._id.toString(), timers);

        } catch (error) {
            console.error('Erro ao enviar mensagem P2P:', error);
            await this.registerActivity(session._id, 'p2p_communication', {
                type: 'error',
                success: false,
                error: error.message
            });
            this.scheduleNextCommunication(session);
        }

    } catch (error) {
        console.error('Erro no ciclo P2P:', error);
        this.scheduleNextCommunication(session);
    }
}

async scheduleNextCommunication(session) {
    const nextInterval = this.calculateP2PInterval();
    const nextAction = Date.now() + nextInterval;
    
    // Salva próxima ação no Redis e na sessão
    session.nextScheduledAction = new Date(nextAction);
    await session.save();
    await RedisTimerService.saveTimer(session._id.toString(), nextAction);

    const timer = setTimeout(() => {
        this.schedulePeerCommunication(session).catch(console.error);
    }, nextInterval);

    const timers = this.executionTimers.get(session._id.toString()) || [];
    timers.push(timer);
    this.executionTimers.set(session._id.toString(), timers);
}

  calculateP2PInterval() {
    // Intervalo entre 1 e 2 minutos
    const minInterval = 60 * 1000; // 1 minuto
    const maxInterval = 120 * 1000; // 2 minutos
    return Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
  }

  generateRandomMessage() {
    const messages = [
      "Oi, tudo bem?",
      "Como vai?",
      "Boa tarde!",
      "Olá, como está?",
      "Oi, posso te fazer uma pergunta?",
      "Oi, você pode me ajudar?",
      "Tudo bem por aí?",
      "Oi, desculpa incomodar",
      "Oi, você está online?",
      "Olá, podemos conversar?",
      "Oi, está ocupado(a)?",
      "Boa noite, como está?"
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }


  calculateNextInterval() {
    // Intervalo entre 5 e 15 minutos
    const minInterval = 20 * 60 * 1000; // 5 minutos
    const maxInterval = 60 * 60 * 1000; // 15 minutos
    return Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
  }


  

    getActiveSessionByInstance(instanceKey) {
        return MaturationSession.findOne({
            instanceKey,
            status: 'active'
        });
    }

    
    async syncOnlineUsers() {
        try {
          // Busca todas as sessões ativas com P2P habilitado
          const sessions = await MaturationSession.find({
            status: 'active',
            'methods.p2pCommunication.enabled': true,
            'methods.p2pCommunication.onlineStatus': true
          });
    
          // Limpa e reconstrói o conjunto de usuários online
          this.onlineUsers.clear();
          for (const session of sessions) {
            this.onlineUsers.add(session.instanceKey);
          }
    
          // Emite evento de atualização
          eventBus.emit('onlineUsers:updated', this.onlineUsers.size);
          
          return this.onlineUsers.size;
        } catch (error) {
          console.error('Erro ao sincronizar usuários online:', error);
        }
      }
      
    async resetDailyLimits() {
        const sessions = await MaturationSession.find({ status: 'active' });
        for (const session of sessions) {
            if (session.methods.groupOwnerInteraction.enabled) {
                session.methods.groupOwnerInteraction.currentCount = 0;
                await session.save();
            }
        }
    }

    async checkActiveSessions() {
        const sessions = await MaturationSession.find({ 
            status: 'active',
            'configuration.endDate': { $lt: new Date() }
        });

        for (const session of sessions) {
            session.status = 'completed';
            await session.save();
            
            this.activeSessions.delete(session.instanceKey);
            this.onlineUsers.delete(session.instanceKey);
            
            // Notifica o usuário
            eventBus.emit('maturation:completed', {
                userId: session.userId,
                instanceKey: session.instanceKey,
                stats: await this.getSessionStats(session._id)
            });
        }
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

    getRandomDelay(min = 1000, max = 5000) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }

    async processQueue() {
        for (const [instanceKey, queue] of this.messageQueue) {
            if (queue.length === 0) continue;

            const session = this.activeSessions.get(instanceKey);
            if (!session || session.status !== 'active') continue;

            const message = queue[0];
            try {
                await sendTextMessage(
                    instanceKey,
                    message.content,
                    this.getRandomDelay(),
                    message.recipient
                );

                await this.registerActivity(session._id, 'message_sent', {
                    success: true,
                    recipient: message.recipient,
                    type: message.type
                });

                queue.shift(); // Remove mensagem processada
            } catch (error) {
                console.error('Error processing message queue:', error);
                await this.registerActivity(session._id, 'message_sent', {
                    success: false,
                    recipient: message.recipient,
                    error: error.message
                });

                // Move para o final da fila após falha
                queue.push(queue.shift());
            }

            // Aguarda intervalo antes da próxima mensagem
            await new Promise(resolve => setTimeout(resolve, this.getRandomDelay(5000, 15000)));
        }
    }

    startQueueProcessor() {
        setInterval(() => this.processQueue(), 1000);
    }

    getOnlineCount() {
        return this.p2pManager.onlineUsers.size;
    }

    isOnline(instanceKey) {
        return this.p2pManager.onlineUsers.has(instanceKey);
    }

    async syncWithDatabase() {
        const activeSessions = await MaturationSession.find({ status: 'active' });
        
        this.activeSessions.clear();
        this.onlineUsers.clear();

        for (const session of activeSessions) {
            this.activeSessions.set(session.instanceKey, session);
            if (session.methods.p2pCommunication.enabled &&
                session.methods.p2pCommunication.onlineStatus) {
                this.onlineUsers.add(session.instanceKey);
            }
        }
    }

    async cleanupP2PCommunication(session) {
        return this.p2pManager.stop(session);
    }
    

    initialize() {
        // Sincroniza com o banco de dados ao iniciar
        this.syncWithDatabase();

        // Inicia processador de fila
        this.startQueueProcessor();

        // Agenda tarefas periódicas
        setInterval(() => this.checkActiveSessions(), 60000); // A cada minuto
        setInterval(() => this.resetDailyLimits(), 86400000); // A cada 24 horas
 setInterval(() => this.monitorActiveSessions(), 60000);

        // Registra handler para limpar recursos ao encerrar
        process.on('SIGTERM', () => this.cleanup());
        process.on('SIGINT', () => this.cleanup());
    }
}

module.exports = new MaturationService();