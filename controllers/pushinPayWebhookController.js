// controllers/pushinPayWebhookController.js
const PushinPayConfig = require('../models/PushinPayConfig');
const redisClient = require('../config/redisConfig');
const eventBus = require('../Helpers/eventBus');
const { executeFunnel } = require('../services/funnelExecutor');
const { avisar } = require("../Helpers/avisos");
const Funnel = require('../models/Funnel'); // Adicione esta linha



// Adicione no início do arquivo
const WEBHOOK_PROCESSED_EXPIRY = 24 * 60 * 60; // 24 horas em segundos

exports.handleWebhook = async (req, res) => {
    try {
        const { token } = req.params;
        const webhookData = req.body;

        // Criar uma chave única para este webhook usando o ID da transação
        const webhookProcessedKey = `webhook_processed:${webhookData.id}`;
        
        // Verificar se este webhook já foi processado
        const alreadyProcessed = await redisClient.get(webhookProcessedKey);
        if (alreadyProcessed) {
            console.log(`Webhook ${webhookData.id} já foi processado anteriormente. Ignorando...`);
            return res.json({
                success: true,
                message: 'Webhook já processado anteriormente',
                status: 'duplicated'
            });
        }

        console.log('Webhook PushinPay recebido:', JSON.stringify(webhookData, null, 2));

        const messageContent = `*Webhook PushinPay Recebido* 📩\n\n` +
            `*ID:* ${webhookData.id}\n` +
            `*Valor:* R$ ${(Number(webhookData.value)/100).toFixed(2)}\n` +
            `*Status:* ${webhookData.status}\n` +
            `*Pagador:* ${webhookData.payer_name}\n` +
            `*CPF:* ${webhookData.payer_national_registration}\n` +
            `*PIX ID:* ${webhookData.end_to_end_id}\n` +
            `*Token:* ${token}\n` +
            `*Data:* ${new Date().toLocaleString('pt-BR')}`;

        //await avisar('5517991134416', messageContent, "darkadm");

    
         // Buscar configuração do pagamento
      const config = await PushinPayConfig.findOne({
        'paymentMappings': { $exists: true },
        [`paymentMappings.${token}`]: { $exists: true }
      });
  
      if (!config) {
        console.error('Configuração não encontrada para o token:', token);
        return res.status(404).json({ error: 'Configuração não encontrada' });
      }
  
      // Obter dados do pagamento do mapping
      const paymentData = config.paymentMappings.get(token);
      console.log('Dados do pagamento encontrados:', paymentData);
  
      // Atualizar status do pagamento
      await config.updateOne({
        $set: {
          [`paymentMappings.${token}`]: {
            ...paymentData,
            status: webhookData.status,
            endToEndId: webhookData.end_to_end_id,
            payerName: webhookData.payer_name,
            payerDocument: webhookData.payer_national_registration,
            updatedAt: new Date()
          }
        }
      });
  


        // Se o pagamento foi aprovado
        if (webhookData.status === 'paid') {
            try {
                // Marcar webhook como processado antes de executar o funil
                await redisClient.setex(webhookProcessedKey, WEBHOOK_PROCESSED_EXPIRY, 'true');

                // Remover timeout do Redis
                await redisClient.del(`payment_timeout_token:${token}`);

             // Recuperar estado do funil
          const autoResponseKey = `auto_response:${paymentData.instanceKey}:${paymentData.chatId}`;
          const stateData = await redisClient.get(autoResponseKey);
  
          if (!stateData) {
            throw new Error('Estado do funil não encontrado');
          }
  
          const state = JSON.parse(stateData);
          
          // Buscar o funil diretamente do Redis
          const funnelKey = `funnel:${paymentData.funnelId}`;
          const funnelData = await redisClient.get(funnelKey);
          
          if (!funnelData) {
            throw new Error('Funil não encontrado no Redis');
          }
  
          const funnel = JSON.parse(funnelData);
          
          // Encontrar próximo nó
          const nextConnection = funnel.connections.find(conn => 
            conn.sourceId === paymentData.nodeId && 
            conn.anchors[0] === 'Right'
          );
  
          if (nextConnection) {
            // Atualizar estado com dados do pagamento
            state.currentNodeId = nextConnection.targetId;
            state.variables = {
              ...state.variables,
              lastPayment: {
                id: webhookData.id,
                amount: Number(webhookData.value)/100,
                payerName: webhookData.payer_name,
                payerDocument: webhookData.payer_national_registration,
                pixId: webhookData.end_to_end_id
              }
            };
  
            // Salvar estado atualizado
            await redisClient.setex(
              autoResponseKey,
              60 * 60 * 24 * 7, // 1 hora
              JSON.stringify(state)
            );
  
            
                // Enviar confirmação para o usuário
                await avisar(
                    paymentData.chatId, 
                    `✅ *Pagamento Aprovado!*\n\n` +
                    `Valor: R$ ${(Number(webhookData.value)/100).toFixed(2)}\n` +
                    `Pagador: ${webhookData.payer_name}\n\n` +
                    `Prosseguindo com seu atendimento...`,
                    paymentData.instanceKey
                );

                // Continuar execução do funil
                console.log('Continuando funil após pagamento aprovado - ID:', webhookData.id);
                await executeFunnel(funnel, paymentData.chatId, paymentData.instanceKey, state);
            }
            } catch (error) {
                // Em caso de erro, remover a marcação de processado para permitir retry
                await redisClient.del(webhookProcessedKey);
                
                console.error('Erro ao processar pagamento aprovado:', error);
                await avisar('5517991134416', 
                    `❌ *Erro ao processar pagamento aprovado*\n\n` +
                    `Token: ${token}\n` +
                    `Erro: ${error.message}\n\n` +
                    `Dados do pagamento:\n${JSON.stringify(paymentData, null, 2)}`, 
                    "darkadm"
                );
            }
        }

        res.json({ 
            success: true,
            message: 'Webhook processado com sucesso',
            status: webhookData.status,
            webhookId: webhookData.id
        });

    } catch (error) {
        console.error('Erro ao processar webhook:', error);
        await avisar('5517991134416', 
            `❌ *Erro no Webhook PushinPay*\n\n${error.message}\n\n${JSON.stringify(error, null, 2)}`, 
            "darkadm"
        );
        res.status(500).json({ error: 'Erro ao processar webhook' });
    }
};

/*/
exports.handleWebhook = async (req, res) => {
    try {
      const { token } = req.params;
      const webhookData = req.body;
      
      console.log('Webhook PushinPay recebido:', JSON.stringify(webhookData, null, 2));
  
      const messageContent = `*Webhook PushinPay Recebido* 📩\n\n` +
        `*ID:* ${webhookData.id}\n` +
        `*Valor:* R$ ${(Number(webhookData.value)/100).toFixed(2)}\n` +
        `*Status:* ${webhookData.status}\n` +
        `*Pagador:* ${webhookData.payer_name}\n` +
        `*CPF:* ${webhookData.payer_national_registration}\n` +
        `*PIX ID:* ${webhookData.end_to_end_id}\n` +
        `*Token:* ${token}\n` +
        `*Data:* ${new Date().toLocaleString('pt-BR')}`;
  
      await avisar('5517991134416', messageContent, "darkadm");
  
      // Buscar configuração do pagamento
      const config = await PushinPayConfig.findOne({
        'paymentMappings': { $exists: true },
        [`paymentMappings.${token}`]: { $exists: true }
      });
  
      if (!config) {
        console.error('Configuração não encontrada para o token:', token);
        return res.status(404).json({ error: 'Configuração não encontrada' });
      }
  
      // Obter dados do pagamento do mapping
      const paymentData = config.paymentMappings.get(token);
      console.log('Dados do pagamento encontrados:', paymentData);
  
      // Atualizar status do pagamento
      await config.updateOne({
        $set: {
          [`paymentMappings.${token}`]: {
            ...paymentData,
            status: webhookData.status,
            endToEndId: webhookData.end_to_end_id,
            payerName: webhookData.payer_name,
            payerDocument: webhookData.payer_national_registration,
            updatedAt: new Date()
          }
        }
      });
  
      // Se o pagamento foi aprovado
      if (webhookData.status === 'paid') {
        try {
          // Remover timeout do Redis
          await redisClient.del(`payment_timeout_token:${token}`);
  
          // Recuperar estado do funil
          const autoResponseKey = `auto_response:${paymentData.instanceKey}:${paymentData.chatId}`;
          const stateData = await redisClient.get(autoResponseKey);
  
          if (!stateData) {
            throw new Error('Estado do funil não encontrado');
          }
  
          const state = JSON.parse(stateData);
          
          // Buscar o funil diretamente do Redis
          const funnelKey = `funnel:${paymentData.funnelId}`;
          const funnelData = await redisClient.get(funnelKey);
          
          if (!funnelData) {
            throw new Error('Funil não encontrado no Redis');
          }
  
          const funnel = JSON.parse(funnelData);
          
          // Encontrar próximo nó
          const nextConnection = funnel.connections.find(conn => 
            conn.sourceId === paymentData.nodeId && 
            conn.anchors[0] === 'Right'
          );
  
          if (nextConnection) {
            // Atualizar estado com dados do pagamento
            state.currentNodeId = nextConnection.targetId;
            state.variables = {
              ...state.variables,
              lastPayment: {
                id: webhookData.id,
                amount: Number(webhookData.value)/100,
                payerName: webhookData.payer_name,
                payerDocument: webhookData.payer_national_registration,
                pixId: webhookData.end_to_end_id
              }
            };
  
            // Salvar estado atualizado
            await redisClient.setex(
              autoResponseKey,
              60 * 60, // 1 hora
              JSON.stringify(state)
            );
  
            // Enviar confirmação para o usuário
            await avisar(
              paymentData.chatId, 
              `✅ *Pagamento Aprovado!*\n\n` +
              `Valor: R$ ${(Number(webhookData.value)/100).toFixed(2)}\n` +
              `Pagador: ${webhookData.payer_name}\n\n` +
              `Prosseguindo com seu atendimento...`,
              paymentData.instanceKey
            );
  
            // Continuar execução do funil
            console.log('Continuando funil após pagamento aprovado');
            await executeFunnel(funnel, paymentData.chatId, paymentData.instanceKey, state);
          }
        } catch (error) {
          console.error('Erro ao processar pagamento aprovado:', error);
          await avisar('5517991134416', 
            `❌ *Erro ao processar pagamento aprovado*\n\n` +
            `Token: ${token}\n` +
            `Erro: ${error.message}\n\n` +
            `Dados do pagamento:\n${JSON.stringify(paymentData, null, 2)}`, 
            "darkadm"
          );
        }
      }
  
      res.json({ 
        success: true,
        message: 'Webhook processado com sucesso',
        status: webhookData.status 
      });
  
    } catch (error) {
      console.error('Erro ao processar webhook:', error);
      await avisar('5517991134416', 
        `❌ *Erro no Webhook PushinPay*\n\n${error.message}\n\n${JSON.stringify(error, null, 2)}`, 
        "darkadm"
      );
      res.status(500).json({ error: 'Erro ao processar webhook' });
    }
  };
/*/
// Função auxiliar para buscar funil
async function getFunnelById(funnelId) {
  return await Funnel.findById(funnelId);
}