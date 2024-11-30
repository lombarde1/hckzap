const axios = require('axios');
const { EventEmitter } = require('events');
const MaturationSession = require('../models/MaturationSession');
const OnlineInstanceService = require('./onlineInstanceService');
const redisClient = require('../config/redisConfig');

class P2PCommunicationService extends EventEmitter {
  constructor() {
    super();
    this.API_BASE_URL = 'https://api.hocketzap.com';
    this.communicationStrategies = {
      aggressive: {
        minInterval: 30000,   // 30 segundos
        maxInterval: 90000,   // 1.5 minutos
        messageVariety: 'high'
      },
      moderate: {
        minInterval: 60000,   // 1 minuto
        maxInterval: 180000,  // 3 minutos
        messageVariety: 'medium'
      },
      conservative: {
        minInterval: 120000,  // 2 minutos
        maxInterval: 300000,  // 5 minutos
        messageVariety: 'low'
      }
    };
  }

  async initializeCommunication(session) {
    try {
      // Valida e prepara sessão
      if (!session.methods.p2pCommunication.enabled) {
        throw new Error('P2P Communication not enabled');
      }

      // Registra instância online
      await OnlineInstanceService.addInstance(session.instanceKey, session);

      // Configura estratégia de comunicação
      const strategy = this.communicationStrategies[
        session.configuration.communicationStrategy || 'moderate'
      ];

      // Inicia ciclo de comunicação
      this.startCommunicationCycle(session, strategy);

      return true;
    } catch (error) {
      this.emit('error', error);
      console.error('[P2P] Erro na inicialização:', error);
      return false;
    }
  }

  async startCommunicationCycle(session, strategy) {
    try {
      // Busca instâncias online
      const onlineInstances = await this.getOnlineInstances(session.instanceKey);

      if (onlineInstances.length === 0) {
        this.scheduleNextCycle(session, strategy, 60000);
        return;
      }

      // Seleciona instância alvo
      const targetInstance = this.selectTargetInstance(onlineInstances);

      if (!targetInstance) {
        this.scheduleNextCycle(session, strategy, 60000);
        return;
      }

      // Envia mensagem
      await this.sendMessage(session, targetInstance, strategy);

      // Agenda próximo ciclo
      this.scheduleNextCycle(session, strategy);

    } catch (error) {
      console.error('[P2P] Erro no ciclo de comunicação:', error);
      this.scheduleNextCycle(session, strategy, 60000);
    }
  }

  async getOnlineInstances(currentInstanceKey) {
    try {
      const response = await axios.get(
        `${this.API_BASE_URL}/instance/fetchInstances`,
        { headers: { apikey: 'darkadm' } }
      );

      return response.data
        .filter(inst => 
          inst.name !== currentInstanceKey && 
          inst.status === 'online'
        )
        .map(inst => ({
          name: inst.name,
          number: inst.number.replace(/\D/g, ''),
          token: inst.name
        }));
    } catch (error) {
      console.error('[P2P] Erro ao buscar instâncias:', error);
      return [];
    }
  }

  selectTargetInstance(instances) {
    return instances[Math.floor(Math.random() * instances.length)];
  }

  async sendMessage(session, target, strategy) {
    try {
      const message = this.generateMessage(strategy.messageVariety);
      
      // Lógica de envio de mensagem (substituir por seu método real)
      await this.sendTextMessage(
        session.instanceKey,
        message,
        1000,
        target.number
      );

      // Registra atividade
      session.activities.push({
        type: 'p2p_communication',
        details: {
          targetInstance: target.name,
          targetNumber: target.number,
          messageContent: message,
          success: true
        },
        severity: 'info'
      });

      session.methods.p2pCommunication.currentCount++;
      await session.save();

      return true;
    } catch (error) {
      console.error('[P2P] Erro ao enviar mensagem:', error);
      
      session.activities.push({
        type: 'p2p_communication',
        details: {
          error: error.message,
          success: false
        },
        severity: 'error'
      });

      await session.save();
      throw error;
    }
  }

  scheduleNextCycle(session, strategy, customInterval = null) {
    const interval = customInterval || this.calculateInterval(strategy);
    
    setTimeout(() => {
      this.startCommunicationCycle(session, strategy)
        .catch(console.error);
    }, interval);
  }

  calculateInterval(strategy) {
    const { minInterval, maxInterval } = strategy;
    return Math.floor(
      Math.random() * (maxInterval - minInterval + 1) + minInterval
    );
  }

  generateMessage(variety = 'medium') {
    const messageLibrary = {
      low: [
        "Olá, tudo bem?",
        "Como vai?",
        "Boa tarde"
      ],
      medium: [
        "Oi, tudo bem?",
        "Como vai você?",
        "Boa tarde, tudo bem?",
        "Olá, como está?",
        "Oi, posso te perguntar algo?"
      ],
      high: [
        "E aí, beleza?",
        "Fala tu!",
        "Qual é?",
        "Tudo certo?",
        "Bora trocar uma ideia?",
        "Beleza, mano?",
        "Salve!",
        "Tudo tranquilo?"
      ]
    };

    const messages = messageLibrary[variety];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // Método placeholder - substituir pela implementação real
  async sendTextMessage(instanceKey, message, delay, number) {
    console.log(`Enviando mensagem de ${instanceKey} para ${number}: ${message}`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

module.exports = new P2PCommunicationService();
