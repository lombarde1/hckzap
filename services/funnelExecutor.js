// services/funnelExecutor.js
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const API_BASE_URL = 'https://api.hocketzap.com';
const ADMIN_TOKEN = 'darklindo'; // Substitua pelo seu token admin real
const redisClient = require('../config/redisConfig');
const User = require('../models/User');
const AUTO_RESPONSE_EXPIRY = 60 * 60 * 24 * 7; // 1 hora em segundos
const { uploadbase64 } = require('../Helpers/uploader'); // Ajuste o caminho conforme necessário
const github = require('../config/git');
const { getChats, getMessages, markChatAsRead, saveMessage } = require('../Helpers/redisHelpers');
const { saveEvent } = require('./eventService');
const io = require('../app'); // Importe o objeto io do seu arquivo app.js
const saoPauloTimezone = 'America/Sao_Paulo';
const eventBus = require('../Helpers/eventBus');
const moment = require('moment-timezone');
const APIKEY = 'darkadm';
const PushinPayConfig = require('../models/PushinPayConfig');
const Groq = require('groq-sdk');

async function saveAutoResponseMessage(instanceKey, chatId, content, type = 'text') {

    const saoPauloTimestamp1 = await moment().tz(saoPauloTimezone).unix();


    const messageKey = `${chatId}:${Date.now()}`;
    const messageData = {
        key: messageKey,
        sender: 'Hocketzap',
        content: content,
        timestamp: saoPauloTimestamp1,

        fromMe: true,
        type: type,
            senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
    };

    await saveMessage(instanceKey, chatId, messageData);
}

const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
const mercadopago = require('mercadopago');

// Modificar a função generatePayment no funnelExecutor.js
async function handlePaymentTimeout(instanceKey, chatId, paymentId, node, funnel, state) {
    const timeoutMs = (node.timeout || 15) * 60 * 1000; // Converte minutos para milissegundos
  
    // Criar uma Promise que será resolvida quando o pagamento for confirmado ou o tempo expirar
    return new Promise(async (resolve) => {
      // Configura um timeout simples
      const timeout = setTimeout(async () => {
        console.log(`Timeout atingido para pagamento ${paymentId}`);
        
        const config = await PushinPayConfig.findOne({
          'paymentMappings': { $exists: true },
          [`paymentMappings.${paymentId}`]: { $exists: true }
        });
  
        const paymentMapping = config?.paymentMappings.get(paymentId);
        
        // Se o pagamento não foi confirmado até o timeout
        if (paymentMapping?.status !== 'paid') {
          console.log('Pagamento não confirmado após timeout');
  
          // Atualizar status do pagamento para expirado
          await config.updateOne({
            $set: {
              [`paymentMappings.${paymentId}.status`]: 'expired'
            }
          });
  
          // Encontrar a conexão de timeout (Bottom)
          const nextConnection = funnel.connections.find(conn => 
            conn.sourceId === node.id && conn.anchors[0] === 'Bottom'
          );
  
          console.log('Próxima conexão para timeout:', nextConnection);
  
          if (nextConnection) {
            state.currentNodeId = nextConnection.targetId;
            const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
            
            // Salvar o novo estado
            await redisClient.setex(
              autoResponseKey,
              AUTO_RESPONSE_EXPIRY,
              JSON.stringify(state)
            );
  
            // Enviar mensagem de timeout
            await sendTextMessage(
              instanceKey,
              "⏰ O tempo para pagamento expirou! Se ainda desejar fazer o pagamento, por favor gere um novo.",
              2,
              chatId
            );
  
            // Continuar a execução do funil
            executeFunnel(funnel, chatId, instanceKey, state);
          }
        }
        
        resolve();
      }, timeoutMs);
  
      // Registrar o timeout no Redis para poder cancelá-lo se o pagamento for confirmado
      await redisClient.setex(
        `payment_timeout_token:${paymentId}`,
        Math.ceil(timeoutMs/1000),
        'pending'
      );
    });
  }
  
  // Atualizar a função generatePayment
  const generatePayment = async (instanceKey, chatId, node, funnel, state) => {
    try {
      console.log('Iniciando geração de pagamento:', {
        amount: node.amount,
        chatId,
        instanceKey
      });
  
      // Busca o usuário e a configuração do PushinPay
      const user = await User.findOne({ 'whatsappInstances.name': instanceKey });
      const config = await PushinPayConfig.findOne({ user: user._id });
  
      if (!config || !config.apiToken) {
        throw new Error('PushinPay não configurado para este usuário');
      }
  
      // Gera um ID único para o pagamento
      const paymentId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Criar URL do webhook
      const webhookUrl = `${process.env.BASE_URL || 'https://dev.hocketzap.com'}/api/webhook/pushinpay/${paymentId}`;
  
      // Gerar pagamento no PushinPay
      const response = await axios.post('https://api.pushinpay.com.br/api/pix/cashIn', 
        {
          value: Math.round(node.amount * 100), // Converte para centavos
          webhook_url: webhookUrl,
          external_reference: paymentId
        },
        {
          headers: {
            'Authorization': `Bearer ${config.apiToken}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );
  console.log(webhookUrl)
      console.log(response.data)
      // Salvar informações do pagamento
      const paymentData = {
        paymentId: response.data.id,
        status: 'pending',
        amount: node.amount,
        chatId,
        instanceKey,
        funnelId: funnel.id,
        nodeId: node.id,
        timeout: node.timeout || 15,
        qrCode: response.data.qr_code,
        qrCodeBase64: response.data.qr_code_base64,
        createdAt: new Date()
      };
  
      // Atualizar configuração do PushinPay
      await config.updateOne({
        $set: {
          [`paymentMappings.${paymentId}`]: paymentData
        }
      });
  
      // Enviar mensagem com QR Code e instruções
      await sendTextMessage(
        instanceKey, 
        `${node.description || '*💰 Pagamento Gerado!*'}\n\nValor: R$ ${node.amount.toFixed(2)}\n\n*Você tem ${node.timeout || 15} minutos para realizar o pagamento.*`, 
        2, 
        chatId
      );
  
      if (response.data.qr_code) {
        await sendTextMessage(
          instanceKey, 
          `*📱 PIX Copia e Cola:*`, 
          2, 
          chatId
        );
        await sendTextMessage(
            instanceKey, 
            `${response.data.qr_code}`, 
            2, 
            chatId
          );
      }
  
    /*/  if (response.data.qr_code_base64) {
        await sendMediaMessage(
          instanceKey,
          response.data.qr_code_base64,
          chatId,
          'image',
          'qrcode.jpg',
          'Escaneie o QR Code para pagar'
        );
      }
  /*/
      // Iniciar timer de timeout
    //  handlePaymentTimeout(instanceKey, chatId, paymentId, node, funnel, state);
  
      return paymentId;
      
    } catch (error) {
      console.error('Erro ao gerar pagamento:', error);
      throw new Error(`Erro ao gerar pagamento: ${error.message}`);
    }
  };




async function checkPayment(instanceKey, frontendPaymentId, chatId) {
    try {
        const user = await User.findOne({ 'whatsappInstances.name': instanceKey });
        console.log('Usuário encontrado:', user);
        console.log('Mapeamento de pagamentos:', user.paymentMapping);

        const accessToken = user.mercadopago.appAccessToken;

        if (!accessToken) {
            throw new Error('Access Token do Mercado Pago não configurado');
        }

        // Buscar o ID real do pagamento usando o ID do frontend
        const realPaymentId = user.paymentMapping.get(frontendPaymentId);
        console.log(`ID frontend: ${frontendPaymentId}, ID real: ${realPaymentId}`);

        if (!realPaymentId) {
            throw new Error(`ID de pagamento real não encontrado para o ID frontend: ${frontendPaymentId}`);
        }

        const client = new mercadopago.MercadoPagoConfig({ accessToken: accessToken });
        const paymentClient = new mercadopago.Payment(client);

        const payment = await paymentClient.get({ id: realPaymentId });
        const isPaid = payment.status === 'approved';

        // Salvar o evento de pagamento (pago ou não pago)
        const eventType = isPaid ? 'PAYMENT_PAID' : 'PAYMENT_NOT_PAID';
        await saveEvent(user._id, chatId, eventType, {
            amount: payment.transaction_amount,
            paymentId: realPaymentId,
            status: payment.status
        });
        
        const saoPauloTimestamp1 = await moment().tz(saoPauloTimezone).unix();
     
           eventBus.emit('newMessage', instanceKey, {
                chatId,
                message: {
                    key: `${chatId}:${saoPauloTimestamp1}`,
                    sender: 'Hocketzap',
                    content: `Verificação de pagamento: ${isPaid ? 'Pago' : 'Não pago'}`,
                    timestamp: saoPauloTimestamp1,
                    fromMe: true,
                    type: 'text',
                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                }
            });
        

        console.log('Resposta da verificação de pagamento:', payment);
        return payment.status === 'approved';
    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);
        throw error;
    }
}

const addAdminTokenToUrl = (url) => {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}admintoken=${ADMIN_TOKEN}`;
};

const PLAN_LIMITS = {
    gratuito: 10,
    plus: 200,
    premium: Infinity
};


function wait(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
}


async function executeTyping(instanceKey, chatId, duration) {
    eventBus.emit('status', instanceKey, {
        chatId,
        status: 'typing',
        duration: duration
    });
     setStatus(instanceKey, 'composing', chatId, duration);

    const delay = parseInt(duration) * 1000; // Convertendo para milissegundos
    console.log(`Aguardando ${delay}ms antes do próximo passo`);
    await new Promise(resolve => setTimeout(resolve, delay));
}


async function executeRecordAudio(instanceKey, chatId, duration, autoResponseKey, state) {
    eventBus.emit('status', instanceKey, {
        chatId,
        status: 'recording',
        duration: duration
    });
    await setStatus(instanceKey, 'recording', chatId, duration);
    const delay = parseInt(duration) * 1000; // Convertendo para milissegundos
    console.log(`Aguardando ${delay}ms antes do próximo passo`);
    await new Promise(resolve => setTimeout(resolve, delay));
    await redisClient.setex(autoResponseKey, AUTO_RESPONSE_EXPIRY, JSON.stringify(state));
}

async function setStatus(instanceKey, status, chatId, duration) {
    try {
         axios.post(`https://budzap.shop/message/setstatus?key=${instanceKey}`, {
            status: status,
            id: chatId,
            delay: duration * 1000, // Converter segundos para milissegundos
            type: 'user'
        });
       // console.log(`Aguardando ${duration * 1000}s antes do próximo passo`);
        return
    } catch (error) {
        console.error(`Erro ao definir status ${status}:`);
    }
}

async function addToGroup(instanceKey, groupId, userId) {
    try {
        await groupController.updateParticipant(instanceKey, groupId, 'add', [userId]);
        console.log(`Usuário ${userId} adicionado ao grupo ${groupId}`);
    } catch (error) {
        console.error('Erro ao adicionar usuário ao grupo:', error);
    }
}

async function removeFromGroup(instanceKey, groupId, userId) {
    try {
        await groupController.updateParticipant(instanceKey, groupId, 'remove', [userId]);
        console.log(`Usuário ${userId} removido do grupo ${groupId}`);
    } catch (error) {
        console.error('Erro ao remover usuário do grupo:', error);
    }
}

async function sendFile(instanceKey, chatId, fileUrl) {
    try {
        // Implemente a lógica para enviar o arquivo usando a API do WhatsApp
        // Você precisará adaptar isso de acordo com a API específica que está usando
    } catch (error) {
        console.error('Erro ao enviar arquivo:', error);
    }
}

async function visualizeMessage(instanceKey, chatId) {
    try {
        // Implemente a lógica para marcar a mensagem como visualizada
        // Você precisará adaptar isso de acordo com a API específica que está usando
    } catch (error) {
        console.error('Erro ao marcar mensagem como visualizada:', error);
    }
}


function formatAIResponse(response) {
    // Aqui você pode adicionar lógica para formatar a resposta da IA
    // Por exemplo, adicionar emojis, quebras de linha, etc.
    return response
        .replace(/\n/g, '\n\n') // Adiciona uma linha extra entre parágrafos
        .replace(/\*\*(.*?)\*\*/g, '*$1*') // Converte negrito de Markdown para WhatsApp
        .replace(/_(.*?)_/g, '_$1_') // Mantém itálico
        .replace(/`(.*?)`/g, '```$1```'); // Converte código inline para bloco de código no WhatsApp
}


const chalk = require('chalk');

// Sistema de logging por instância
const createLogger = (instanceKey) => {
  const getInstanceColor = (() => {
    const colors = ['blue', 'magenta', 'cyan', 'yellow', 'green', 'red'];
    const instanceColors = new Map();
    let colorIndex = 0;

    return (instance) => {
      if (!instanceColors.has(instance)) {
        instanceColors.set(instance, colors[colorIndex % colors.length]);
        colorIndex++;
      }
      return instanceColors.get(instance);
    };
  })();

  const color = getInstanceColor(instanceKey);
  return {
    info: (message) => console.log(chalk[color](`[${instanceKey}][INFO] ${message}`)),
    error: (message) => console.log(chalk.red(`[${instanceKey}][ERROR] ${message}`)),
    debug: (message) => console.log(chalk[color].dim(`[${instanceKey}][DEBUG] ${message}`)),
    success: (message) => console.log(chalk[color].bold(`[${instanceKey}][SUCCESS] ${message}`))
  };
};

async function executeWithResourceControl(funnel, chatId, instanceKey, state, emitEvent) {
    const logger = createLogger(instanceKey);
    logger.info(`Iniciando execução do funil: ${funnel.name}`);
    logger.debug(`Dados iniciais: chatId=${chatId}, estado atual=${JSON.stringify(state)}`);
    logger.debug(`Estado das variáveis: ${JSON.stringify(state.variables || {})}`);
 







    // 1. Cache de nós do funil
    const nodeCache = new Map();
    funnel.nodes.forEach(node => {
        nodeCache.set(node.id, node);
    });

    // 2. Pipeline Redis para operações em lote
    const redisPipeline = redisClient.pipeline();
    const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
  
    // 3. Controle de concorrência por chat
    const lockKey = `lock:${instanceKey}:${chatId}`;
    const lock = await redisClient.set(lockKey, '1', 'NX', 'EX', 30); // Lock de 30 segundos
    
    if (!lock) {
       console.log(`Funil já em execução para ${chatId}`);
        return;
    }

    try {
        // 4. Inicialização otimizada de estado
        if (!state.variables) {
            state.variables = {};
            state.apiResults = {};
        }

        // 5. Batch de promessas para operações paralelas
        const promises = [];
        
        // 6. Sistema de retry para operações críticas
        const retryOperation = async (operation, maxRetries = 3) => {
            let lastError;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    return await operation();
                } catch (error) {
                    lastError = error;
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
                }
            }
            throw lastError;
        };

        while (state.currentNodeId) {
            // 7. Recuperação de nó otimizada
            const currentNode = nodeCache.get(state.currentNodeId);
            if (!currentNode) {
                logger.error(`Nó não encontrado: ${state.currentNodeId}`);
                break;
            }

            // 8. Gerenciamento de memória
            if (promises.length > 10) {
                await Promise.all(promises);
                promises.length = 0;
            }

            // 9. Verificação de timeout global
            const startTime = Date.now();
            if (startTime - state.startTime > 300000) { // 5 minutos
                console.log(`Timeout de execução do funil para ${chatId}`);
                break;
            }

            try {

                logger.info(`Processando nó: ${currentNode.type} (ID: ${currentNode.id})`);
logger.debug(`Dados do nó: ${JSON.stringify(currentNode)}`);


                // 10. Recuperação de estado otimizada
                if (state.status === 'waiting_for_input') {
                    const lastMessage = await retryOperation(() => 
                        redisClient.get(`last_message:${instanceKey}:${chatId}`)
                    );
                    state.lastMessage = lastMessage;
                }

                const saoPauloTimestamp = moment().tz(saoPauloTimezone).unix();

            switch (currentNode.type) {
                
                case 'randomPath':
    try {
        // Encontrar todas as conexões que saem deste nó
        const possibleConnections = funnel.connections.filter(conn => 
            conn.sourceId === currentNode.id
        );

        if (possibleConnections.length === 0) {
            console.log('Nenhum caminho disponível para randomPath');
            state.currentNodeId = null;
        } else {
            // Escolher uma conexão aleatoriamente
            const randomConnection = possibleConnections[
                Math.floor(Math.random() * possibleConnections.length)
            ];
            
            // Registrar o caminho escolhido
            console.log(`Caminho aleatório escolhido: ${randomConnection.targetId}`);
            
            // Atualizar o estado com o próximo nó
            state.currentNodeId = randomConnection.targetId;
            
            // Salvar uma mensagem informativa
            await saveAutoResponseMessage(
                instanceKey, 
                chatId, 
                "🎲 Caminho aleatório selecionado", 
                'text'
            );

            // Emitir evento de mensagem
         
            eventBus.emit('newMessage', instanceKey, {
                chatId,
                message: {
                    key: `${chatId}:${saoPauloTimestamp}`,
                    sender: 'Hocketzap',
                    content: "🎲 Caminho aleatório selecionado",
                    timestamp: saoPauloTimestamp,
                    fromMe: true,
                    type: 'text',
                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                }
            });
        }
        
        // Continuar a execução
        continue;
    } catch (error) {
        console.error('Erro ao processar caminho aleatório:', error);
        state.currentNodeId = null;
    }
    break;

                case 'collectNumber':
                    state.variables.currentChatNumber = chatId.split('@')[0];
                    console.log(`Número do chat coletado: ${state.variables.currentChatNumber}`);
                    break;

                case 'savePurchaseEvent':
                    const eventData = {
                        chatId: state.variables.currentChatNumber,
                        eventType: currentNode.eventType,
                        timestamp: Date.now()
                    };
                    await saveEvent(eventData);
                    console.log(`Evento de compra salvo: ${JSON.stringify(eventData)}`);
                    break;

                case 'sendToOtherNumber':
                    const targetNumber = replaceVariables(currentNode.targetNumber, state);
                    const messageContent2 = replaceVariables(currentNode.messageContent, state);
                    
                    switch (currentNode.messageType) {
                        case 'text':
                            await sendTextMessage(instanceKey, messageContent2, targetNumber);
                            break;
                        case 'image':
                        case 'video':
                        case 'audio':
                          //  await sendAudioMessage(instanceKey, )
                            await sendMediaMessage(instanceKey, messageContent2, targetNumber, currentNode.messageType, `${currentNode.messageType}.${currentNode.messageType === 'image' ? 'jpg' : currentNode.messageType === 'video' ? 'mp4' : 'mp3'}`, currentNode.caption || '');
                            break;
                        default:
                            console.log(`Tipo de mensagem não suportado: ${currentNode.messageType}`);
                    }
                    console.log(`Mensagem enviada para ${targetNumber}`);
                    break;

                    case 'nameExtractor':
                        try {
                            const apiKey = process.env.groqkey;
                            const groq = new Groq({
                                apiKey: apiKey
                              });
                    
                            const aiPrompt = replaceVariables(currentNode.aiPrompt, state);
                            console.log("Prompt para extração de nome:", aiPrompt);
                    
                            const chatCompletion = await groq.chat.completions.create({
                                messages: [
                                    {
                                        role: "system",
                                        content: "Irei te fornecer uma frase e quero que voce extraia o nome (independe do sexo ou nacionalidade) que contenha nela (caso contenha), retorne o nome extraido no valor de \"result\" NO JSON"
                                    },
                                    {
                                        role: "user",
                                        content: aiPrompt
                                    }
                                ],
                                model: "llama3-8b-8192",
                                temperature: 1,
                                max_tokens: 1024,
                                top_p: 1,
                                stream: false,
                                response_format: {
                                    type: "json_object"
                                },
                                stop: null
                            });
                    
                            const responseContent = chatCompletion.choices[0].message.content;
                            console.log("Resposta da IA:", responseContent);
                    
                            // Parse da resposta JSON
                            const jsonResponse = JSON.parse(responseContent);
                    
                            if (!jsonResponse.result || jsonResponse.result === '') {
                                console.log("Nenhum nome encontrado na resposta");
                                state.variables[currentNode.outputVariable] = "amg";
                            } else {
                                const extractedName = jsonResponse.result;
                                // Salva diretamente no outputVariable
                                state.variables[currentNode.outputVariable] = extractedName;
                                console.log(`Nome extraído: "${extractedName}"`);
                                console.log('Estado após extração:', state.variables);
                    
                                eventBus.emit('newMessage', instanceKey, {
                                    chatId,
                                    message: {
                                        key: `${chatId}:${saoPauloTimestamp}`,
                                        sender: 'Hocketzap',
                                        content: `Nome extraído: ${extractedName}`,
                                        timestamp: saoPauloTimestamp,
                                        fromMe: true,
                                        type: 'text',
                                        senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('Erro ao extrair nome:', error);
                            state.variables[currentNode.outputVariable] = '';
                        }
                        break;
   
    // Adicione ao switch case na função executeFunnel:
 // Em funnelExecutor.js
case 'button':
    try {
      // Preparar os dados do botão
      const buttonsData = {
        number: chatId,
        title: currentNode.title || '',
        description: currentNode.description || '',
        footer: currentNode.footer || '',
        buttons: currentNode.buttons.map(button => ({
          type: button.type,
          displayText: button.displayText,
          ...(button.type === 'reply' && { id: button.id }),
          ...(button.type === 'url' && { url: button.url }),
          ...(button.type === 'call' && { phoneNumber: button.phoneNumber }),
          ...(button.type === 'copy' && { copyCode: button.copyCode })
        }))
      };
  
      // Enviar mensagem com botões
      await axios.post(
        `${API_BASE_URL}/message/sendButtons/${instanceKey}`,
        buttonsData,
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': APIKEY
          }
        }
      );
  
      // Registrar a mensagem enviada
      await saveAutoResponseMessage(
        instanceKey,
        chatId,
        `Botões enviados: ${currentNode.title}\n${currentNode.description}`,
        'buttons'
      );
  
      // Emitir evento de mensagem
      eventBus.emit('newMessage', instanceKey, {
        chatId,
        message: {
          key: `${chatId}:${Date.now()}`,
          sender: 'Hocketzap',
          content: `Botões enviados:\n${currentNode.title}\n${currentNode.description}`,
          timestamp: Math.floor(Date.now() / 1000),
          fromMe: true,
          type: 'buttons',
          senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
        }
      });
  
      // Verificar se há botões do tipo 'reply'
      const hasReplyButtons = currentNode.buttons.some(button => button.type === 'reply');
  
      if (hasReplyButtons) {
        // Se houver botões de resposta, atualizar o estado para aguardar
        state.status = 'waiting_for_button';
        state.expectedButtons = currentNode.buttons
          .filter(b => b.type === 'reply')
          .map(b => b.displayText.toLowerCase());
  
        // Salvar o estado e aguardar resposta
        await redisClient.setex(
          `auto_response:${instanceKey}:${chatId}`,
          AUTO_RESPONSE_EXPIRY,
          JSON.stringify(state)
        );
  
        // Parar a execução aqui e aguardar resposta do usuário
        return;
      } else {
        // Se não houver botões de resposta, procurar a próxima conexão e continuar
        const nextConnection = funnel.connections.find(conn => conn.sourceId === currentNode.id);
        state.currentNodeId = nextConnection ? nextConnection.targetId : null;
        
        // Salvar o estado atualizado
        await redisClient.setex(
          `auto_response:${instanceKey}:${chatId}`,
          AUTO_RESPONSE_EXPIRY,
          JSON.stringify(state)
        );
  
        // Continuar para o próximo nó sem esperar resposta
        if (state.currentNodeId) {
          continue;
        }
      }
    } catch (error) {
      console.error('Erro ao enviar botões:', error);
      throw error;
    }
    break;
    case 'videoMessage':
        try {
            // Baixe o vídeo usando o videourl
            const videoResponse = await axios.get(currentNode.content, { responseType: 'arraybuffer' });
            const videoBuffer = Buffer.from(videoResponse.data);
    
            // Prepare o FormData com o vídeo
            const formData = new FormData();
            formData.append('number', chatId);
            formData.append('file', videoBuffer, { filename: 'video.mp4', contentType: 'video/mp4' });
    
            // Envie a solicitação para a API
            await axios.post(
                `https://api.hocketzap.com/message/sendPtv/${instanceKey}`,
                formData,
                {
                    headers: {
                        'apikey': 'darkadm',
                        ...formData.getHeaders()
                    }
                }
            );
    
            await saveAutoResponseMessage(instanceKey, chatId, "Recado de vídeo enviado", 'video');
        } catch (error) {
            console.error('Erro ao enviar recado de vídeo:', error);
        }
        break;
    

case 'stickerMessage':
    try {
        await axios.post(
            `https://api.hocketzap.com/message/sendSticker/${instanceKey}`,
            {
                number: chatId,
                sticker: currentNode.stickerUrl
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': 'darkadm'
                }
            }
        );

        await saveAutoResponseMessage(instanceKey, chatId, "Figurinha enviada", 'sticker');
    } catch (error) {
        console.error('Erro ao enviar figurinha:', error);
    }
    break;

case 'fakeCall':
    try {
        await axios.post(
            `https://api.hocketzap.com/call/offer/${instanceKey}`,
            {
                number: `${chatId}`,
                isVideo: currentNode.isVideo,
                callDuration: Math.min(currentNode.duration, 15)
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': 'darkadm'
                }
            }
        );

        await saveAutoResponseMessage(instanceKey, chatId, 
            `Chamada ${currentNode.isVideo ? 'de vídeo' : 'de voz'} iniciada`, 'text');
    } catch (error) {
        console.error('Erro ao iniciar chamada:', error);
    }
    break;

case 'location':
    try {
        await axios.post(
            `https://api.hocketzap.com/message/sendLocation/${instanceKey}`,
            {
                number: chatId,
                name: currentNode.address,
                address: currentNode.address,
                latitude: parseFloat(currentNode.latitude),
                longitude: parseFloat(currentNode.longitude)
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': 'darkadm'
                }
            }
        );

        await saveAutoResponseMessage(instanceKey, chatId, 
            `Localização enviada: ${currentNode.address}`, 'location');
    } catch (error) {
        console.error('Erro ao enviar localização:', error);
    }
    break;
    case 'aiAgent':
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
        // Recuperar histórico da memória do Redis
        const memoryKey = `ai_memory:${currentNode.aiMemoryId}`;
        let history = JSON.parse(await redisClient.get(memoryKey)) || [];
    
        // Preparar o prompt substituindo variáveis
        let preparedPrompt = replaceVariables(currentNode.aiPrompt, state);
    
        console.log('Prompt preparado para o agente IA:', preparedPrompt);
    
        // Adicionar a nova mensagem ao histórico
        history.push({ role: "user", parts: [{ text: preparedPrompt }] });
    
        // Iniciar o chat com o histórico
        const chat = model.startChat({ history });
    
        try {
            const result = await chat.sendMessage(preparedPrompt);
            const aiResponse = result.response.text().replace(/\n+$/, '')
    
 

            console.log('Resposta do agente IA:', aiResponse);
    
            // Adicionar a resposta da IA ao histórico
            history.push({ role: "model", parts: [{ text: aiResponse }] });
    
            // Salvar o histórico atualizado no Redis
            await redisClient.set(memoryKey, JSON.stringify(history));
    
          // Armazenar a resposta da IA nas variáveis do estado usando o shortId
          const shortId = `AI_${currentNode.id.substr(-4)}`;
          state.variables[shortId] = aiResponse;
    
            // Formatar a resposta da IA para envio
            const formattedResponse = formatAIResponse(aiResponse);
    
            await saveAutoResponseMessage(instanceKey, chatId, "Resposta da IA > " + formattedResponse, 'text');
        
               eventBus.emit('newMessage', instanceKey, {
                    chatId,
                    message: {
                        key: `${chatId}:${saoPauloTimestamp}`,
                        sender: 'Hocketzap',
                        content: "Resposta da IA > " + formattedResponse,
                        timestamp: saoPauloTimestamp,
                        fromMe: true,
                        type: 'text',
                        senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                    }
                });
            

            // Enviar a resposta formatada
           // await sendTextMessage(instanceKey, formattedResponse, chatId);
        } catch (error) {
            console.error('Erro ao processar resposta do agente IA:', error);
            await sendTextMessage(instanceKey, "Desculpe, ocorreu um erro ao processar sua solicitação.", 3, chatId);
        }
        break;
                case 'randomMessage':
    const randomIndex = Math.floor(Math.random() * currentNode.messages.length);
    await sendTextMessage(instanceKey, currentNode.messages[randomIndex], 3, chatId);
    await saveAutoResponseMessage(instanceKey, chatId, currentNode.messages[randomIndex], 'text');

       eventBus.emit('newMessage', instanceKey, {
            chatId,
            message: {
                key: `${chatId}:${saoPauloTimestamp}`,
                sender: 'Hocketzap',
                content: currentNode.messages[randomIndex],
                timestamp: saoPauloTimestamp,
                fromMe: true,
                type: 'text',
                senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
            }
        });
    
    break;
    case 'apiRequest':
        try {
            console.log('Processing API Request node:', currentNode); // Log para debug
            const url = replaceVariables(currentNode.apiUrl, state);
            console.log('Processed URL:', url); // Log para debug
    
            if (!url) {
                throw new Error('URL da API não configurada');
            }
    
            const response = await axios({
                method: currentNode.requestType || 'GET',
                url: url,
                headers: currentNode.headers ? JSON.parse(replaceVariables(JSON.stringify(currentNode.headers), state)) : {},
                data: currentNode.requestBody ? JSON.parse(replaceVariables(currentNode.requestBody, state)) : {}
            });
    
            console.log('API Response:', response.data); // Log para debug
    
            state.apiResults[currentNode.id] = response.data;
            if (currentNode.responseVariable) {
                state.variables[currentNode.responseVariable] = response.data;
                await saveAutoResponseMessage(instanceKey, chatId, `API Request realizado: ${currentNode.apiUrl}`, 'text');
               
                   eventBus.emit('newMessage', instanceKey, {
                        chatId,
                        message: {
                            key: `${chatId}:${saoPauloTimestamp}`,
                            sender: 'Hocketzap',
                            content: `API Request realizado: ${currentNode.apiUrl}`,
                            timestamp: saoPauloTimestamp,
                            fromMe: true,
                            type: 'text',
                            senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                        }
                    });
               

            }
        } catch (error) {
            console.error('Erro na requisição API:', error);
            state.apiResults[currentNode.id] = { error: error.message };
        }
        break;

                case 'message':
                    // Verifica se o nó anterior era um input e salva a resposta se necessário
                   // if (state.status === 'waiting_for_input' && state.saveResponse && state.lastMessage) {
                    //    state.userInputs[currentNode.inputKey] = state.lastMessage;
                     //   state.status = 'in_progress';
                  //  }

        

                    let messageContent = currentNode.content;
                    messageContent = replaceVariables(messageContent, state);
                    await sendTextMessage(instanceKey, messageContent, currentNode.delay, chatId);
                    await saveAutoResponseMessage(instanceKey, chatId, messageContent, 'text');

                    logger.debug(`Preparando mensagem: ${messageContent}`);
                    logger.info(`Mensagem enviada para ${chatId}`);

                    const messageTimestamp = Date.now();
                    const messageData = {
                        key: `${chatId}:${saoPauloTimestamp}`,
                        sender: 'Hocketzap',
                        content: messageContent,
                        timestamp: saoPauloTimestamp,
                        fromMe: true,
                        type: 'text',
                        senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                    };

                    //await saveAutoResponseMessage(instanceKey, chatId, messageContent, 'text');

                    // Usar a função de callback para emitir o evento
                // Emitir o evento usando o eventBus
                eventBus.emit('newMessage', instanceKey, { chatId, message: messageData });

                    break;
                   // Atualizar o case generatePayment no executeFunnel
case 'generatePayment':
    try {
      const paymentId = await generatePayment(instanceKey, chatId, currentNode, funnel, state);
      currentNode.paymentId = paymentId;
      console.log(`Pagamento ${paymentId} gerado com timeout de ${currentNode.timeout} minutos`);
      
      // Iniciar o timer de timeout e aguardar
      await handlePaymentTimeout(instanceKey, chatId, paymentId, currentNode, funnel, state);
      
      // Não continua a execução - o fluxo será retomado pelo webhook ou timeout
      return;
    } catch (error) {
      console.error('Erro ao gerar pagamento:', error);
      await sendTextMessage(
        instanceKey,
        "❌ Erro ao gerar pagamento. Por favor, tente novamente.",
        2,
        chatId
      );
      break;
    
                        }
                        case 'checkPayment':
                            try {
                                if (!currentNode.paymentToCheck) {
                                    throw new Error('Nenhum pagamento selecionado para verificação');
                                }
                                const isPaid = await checkPayment(instanceKey, currentNode.paymentToCheck, chatId);
                                const nextConnection2 = funnel.connections.find(conn => 
                                    conn.sourceId === currentNode.id && 
                                    (isPaid ? conn.anchors[0] === 'Right' : conn.anchors[0] === 'Bottom')
                                );
                                state.currentNodeId = nextConnection2 ? nextConnection2.targetId : null;
                                await saveAutoResponseMessage(instanceKey, chatId, `Pagamento gerado: ${currentNode.paymentId}`, 'text');
                              
                                   eventBus.emit('newMessage', instanceKey, {
                                        chatId,
                                        message: {
                                            key: `${chatId}:${saoPauloTimestamp}`,
                                            sender: 'Hocketzap',
                                            content: `Pagamento gerado: ${currentNode.paymentId}`,
                                            timestamp: saoPauloTimestamp,
                                            fromMe: true,
                                            type: 'text',
                                            senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                        }
                                    });
                              

                            } catch (error) {
                                console.error(`Erro ao processar nó ${currentNode.id}:`, error);
                                await sendTextMessage(instanceKey, `Erro ao verificar pagamento: ${error.message}`, 3, chatId);
                                break;
                            }
                            continue; // Continua para o próximo nó
                    case 'typing':
                        await executeTyping(instanceKey, chatId, currentNode.duration);
                        
                        break;
                        case 'recordAudio':
                            await executeRecordAudio(instanceKey, chatId, currentNode.duration, autoResponseKey, state);
                            console.log('Gravação de áudio concluída, passando para o próximo nó');
                            break;
                    case 'addToGroup':
                        await addToGroup(currentNode.instanceKey, currentNode.groupId, chatId);
                        await saveAutoResponseMessage(instanceKey, chatId, `Usuário adicionado ao grupo: ${currentNode.groupId}`, 'text');
                     
                           eventBus.emit('newMessage', instanceKey, {
                                chatId,
                                message: {
                                    key: `${chatId}:${saoPauloTimestamp}`,
                                    sender: 'Hocketzap',
                                    content: `Usuário adicionado ao grupo: ${currentNode.groupId}`,
                                    timestamp: saoPauloTimestamp,
                                    fromMe: true,
                                    type: 'text',
                                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                }
                            });
                        
                        break;
                    case 'removeFromGroup':
                        await removeFromGroup(currentNode.instanceKey, currentNode.groupId, chatId);
                        await saveAutoResponseMessage(instanceKey, chatId, `Usuário removido do grupo: ${currentNode.groupId}`, 'text');
                    
                           eventBus.emit('newMessage', instanceKey, {
                                chatId,
                                message: {
                                    key: `${chatId}:${saoPauloTimestamp}`,
                                    sender: 'Hocketzap',
                                    content: `Usuário removido do grupo: ${currentNode.groupId}`,
                                    timestamp: saoPauloTimestamp,
                                    fromMe: true,
                                    type: 'text',
                                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                }
                            });
                    
                        break;
                    case 'sendFile':
                        await sendFile(instanceKey, chatId, currentNode.fileUrl);
                        break;
                    case 'visualize':
                        await visualizeMessage(instanceKey, chatId);
                        break;
                     case 'input':
                            if (state.status !== 'waiting_for_input') {
                                await sendTextMessage(instanceKey, currentNode.content, currentNode.delay, chatId);
                                await saveAutoResponseMessage(instanceKey, chatId, currentNode.content, 'text');

                                const messageData = {
                                    key: `${chatId}:${saoPauloTimestamp}`,
                                    sender: 'Hocketzap',
                                    content: currentNode.content,
                                    timestamp: saoPauloTimestamp,
                                    fromMe: true,
                                    type: 'text',
                                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                };
            
                                //await saveAutoResponseMessage(instanceKey, chatId, currentNode.content, 'text');
            
                                // Usar a função de callback para emitir o evento
                             
                                   
                                    eventBus.emit('newMessage', instanceKey, { chatId, message: messageData });

                                state.status = 'waiting_for_input';
                                state.expectedInput = currentNode.inputKey;
                                await redisClient.setex(autoResponseKey, AUTO_RESPONSE_EXPIRY, JSON.stringify(state));
                                return; // Retorna aqui para esperar a entrada do usuário
                            } else {
                                // Se já recebemos o input, salvamos no estado
                                state.userInputs[currentNode.inputKey] = state.lastMessage;
                                state.status = 'in_progress';
                                console.log(`Resposta do input ${currentNode.inputKey}:`, state.lastMessage);
                            }
                            break;
                    case 'condition':
                        const conditionResult = evaluateCondition(currentNode, state);
                        console.log(`Avaliação da condição: ${conditionResult ? 'Verdadeira' : 'Falsa'}`);
                        const nextConnection = funnel.connections.find(conn => 
                            conn.sourceId === currentNode.id && 
                            (conditionResult ? conn.anchors[0] === 'Right' : conn.anchors[0] === 'Bottom')
                        );
                        state.currentNodeId = nextConnection ? nextConnection.targetId : null;
                        continue;
                case 'wait':
                    eventBus.emit('status', instanceKey, {
                        chatId,
                        status: 'waiting',
                        duration: currentNode.content
                    });
                    const delay = parseInt(currentNode.content) * 1000; // Convertendo para milissegundos
                    console.log(`Aguardando ${delay}ms antes do próximo passo`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    break;
                    case 'image':
                        case 'video':
                            await sendMediaMessage(instanceKey, currentNode.content, chatId, currentNode.type === 'image' ? 'image' : 'video', `${currentNode.type}.${currentNode.type === 'image' ? 'jpg' : 'mp4'}`, currentNode.caption);
                            await saveAutoResponseMessage(instanceKey, chatId, currentNode.content, currentNode.type);
                            
                               eventBus.emit('newMessage', instanceKey, {
                                    chatId,
                                    message: {
                                        key: `${chatId}:${saoPauloTimestamp}`,
                                        sender: 'Hocketzap',
                                        content: currentNode.content,
                                        caption: currentNode.caption,
                                        timestamp: saoPauloTimestamp,
                                        fromMe: true,
                                        type: currentNode.type,
                                        senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                    }
                                });
                            
                            break;
                            case 'audio':
                                console.log('Iniciando envio de áudio');
                              //  await sendMediaMessage(instanceKey, currentNode.content, chatId, 'audiofile', 'audio.mp3', '');
                             await sendAudioMessage(instanceKey, currentNode.content, currentNode.delay, chatId)
                                console.log('Áudio enviado com sucesso');
                                await saveAutoResponseMessage(instanceKey, chatId, currentNode.content, 'audio');
                                const messageData2 = {
                                    key: `${chatId}:${saoPauloTimestamp}`,
                                    sender: 'Hocketzap',
                                    content: currentNode.content,
                                    timestamp: saoPauloTimestamp,
                                    fromMe: true,
                                    type: 'text',
                                    senderImage: 'https://img.freepik.com/vetores-premium/robo-bonito-icon-ilustracao-conceito-de-icone-de-robo-de-tecnologia-isolado-estilo-cartoon-plana_138676-1220.jpg'
                                };

                                   eventBus.emit('newMessage', instanceKey, {
                                        chatId,
                                        message: messageData2
                                    });
                                

                                break;
                    
                        case 'blockUser':
                            return `<p>Bloquear usuário</p>`;
                        case 'deleteConversation':
                            break;
                      

                default:
                    console.log(`Tipo de nó não suportado: ${currentNode.type}`);
                    break;
            }

            // Encontrar a próxima conexão
          const nextConnection = funnel.connections.find(conn => conn.sourceId === currentNode.id);
                state.currentNodeId = nextConnection ? nextConnection.targetId : null;

                // 12. Batch de operações Redis
                redisPipeline.setex(
                    autoResponseKey,
                    AUTO_RESPONSE_EXPIRY,
                    JSON.stringify(state)
                );

                // 13. Limpeza periódica
                if (state.currentNodeId === null) {
                    redisPipeline.del(autoResponseKey);
                }

            } catch (error) {
                logger.error(`Erro ao processar nó ${currentNode.id}:`, error);
                console.log(error)
                // 14. Recuperação de erros graceful
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
                break;
            }
        }

        // 15. Execução de operações em lote
        await Promise.all(promises);
        await redisPipeline.exec();

    } catch (error) {
        logger.error('Erro fatal na execução do funil:', error);
    } finally {
        // 16. Limpeza garantida
        await redisClient.del(lockKey);
        nodeCache.clear();
    }

    logger.info(`Funil concluído para ${chatId}`);
}


// 17. Auxiliares para gerenciamento de recursos
// 17. Auxiliares para gerenciamento de recursos
const resourceManager = {
    maxConcurrentExecutions: 200, // Total global
    maxInstanceExecutions: 5,    // Limite por instância
    currentExecutions: 0,
    instanceExecutions: new Map(), // Controle por instância
    
    async acquire(instanceKey) {
        // Inicializa contador da instância se não existir
        if (!this.instanceExecutions.has(instanceKey)) {
            this.instanceExecutions.set(instanceKey, 0);
        }

        const instanceCount = this.instanceExecutions.get(instanceKey);
        
        console.log(`🔍 Tentando adquirir recurso para instância ${instanceKey}`);
        console.log(`   Global: ${this.currentExecutions}/${this.maxConcurrentExecutions}`);
        console.log(`   Instância: ${instanceCount}/${this.maxInstanceExecutions}`);
        
        while (
            this.currentExecutions >= this.maxConcurrentExecutions || 
            instanceCount >= this.maxInstanceExecutions
        ) {
            console.log(`⏳ Aguardando liberação...`);
            console.log(`   Global: ${this.currentExecutions}/${this.maxConcurrentExecutions}`);
            console.log(`   Instância ${instanceKey}: ${instanceCount}/${this.maxInstanceExecutions}`);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.currentExecutions++;
        this.instanceExecutions.set(instanceKey, instanceCount + 1);
        
        console.log(`✅ Recurso adquirido para instância ${instanceKey}!`);
        console.log(`   Global: ${this.currentExecutions}/${this.maxConcurrentExecutions}`);
        console.log(`   Instância: ${this.instanceExecutions.get(instanceKey)}/${this.maxInstanceExecutions}`);
    },
    
    release(instanceKey) {
        this.currentExecutions--;
        const instanceCount = this.instanceExecutions.get(instanceKey);
        if (instanceCount > 0) {
            this.instanceExecutions.set(instanceKey, instanceCount - 1);
        }
        
        console.log(`🔓 Recurso liberado para instância ${instanceKey}`);
        console.log(`   Global: ${this.currentExecutions}/${this.maxConcurrentExecutions}`);
        console.log(`   Instância: ${this.instanceExecutions.get(instanceKey)}/${this.maxInstanceExecutions}`);
    }
};

// 18. Wrapper para controle de execução
/*/
async function executeFunnel(funnel, chatId, instanceKey, state, emitEvent) {
    await resourceManager.acquire(instanceKey);
    try {
        return await executeWithResourceControl(funnel, chatId, instanceKey, state, emitEvent);
    } finally {
        resourceManager.release(instanceKey);
    }
}
/*/

const queueManager = require('./queueManager');

async function executeFunnel(funnel, chatId, instanceKey, state, emitEvent) {
    // Criar identificador único para este fluxo
    const flowId = `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Criar logger específico para este fluxo
    const logger = createLogger(instanceKey);
    logger.info(`Iniciando execução do funil ${funnel.name} (ID: ${flowId})`);
    
    return new Promise(async (resolve, reject) => {
        try {
            // Enfileirar a execução do funil
            await queueManager.enqueue(instanceKey, async () => {
                try {
                    logger.debug(`Iniciando processamento do funil ${flowId}`);
                    const startTime = Date.now();

                    // Executar o funil
                    const result = await executeWithResourceControl(funnel, chatId, instanceKey, state, emitEvent);

                    const executionTime = Date.now() - startTime;
                    logger.info(`Funil ${flowId} executado com sucesso em ${executionTime}ms`);

                    resolve(result);
                } catch (error) {
                    logger.error(`Erro na execução do funil ${flowId}: ${error.message}`);
                    logger.debug(error.stack);
                    reject(error);
                }
            });

            // Configurar listeners para eventos do fluxo
            const taskId = `${instanceKey}_${flowId}`;
            
            queueManager.on('taskStarted', (event) => {
                if (event.taskId === taskId) {
                    logger.debug(`Funil ${flowId} iniciando processamento (tentativa ${event.attempt})`);
                }
            });

            queueManager.on('taskCompleted', (event) => {
                if (event.taskId === taskId) {
                    logger.info(`Funil ${flowId} completado em ${event.processingTime}ms`);
                }
            });

            queueManager.on('taskError', (event) => {
                if (event.taskId === taskId) {
                    logger.error(`Erro no funil ${flowId}: ${event.error}`);
                }
            });

        } catch (error) {
            logger.error(`Erro ao enfileirar funil ${flowId}: ${error.message}`);
            reject(error);
        }
    });
}

// Middleware para monitoramento geral do sistema
queueManager.on('metrics', (metrics) => {
    const highLoad = metrics.currentLoad > (queueManager.config.maxGlobalConcurrent * 0.8);
    
    if (highLoad) {
        console.warn(`⚠️ Sistema com alta carga:
            - Carga atual: ${metrics.currentLoad}
            - Filas ativas: ${metrics.activeQueues}
            - Taxa de erro: ${(metrics.errorRate * 100).toFixed(2)}%
        `);
    }

    // Log periódico de métricas
  /*/  console.log(`📊 Métricas do sistema:
        - Processados: ${metrics.totalProcessed}
        - Carga atual: ${metrics.currentLoad}
        - Pico de carga: ${metrics.peakLoad}
        - Filas ativas: ${metrics.activeQueues}
        - Taxa de erro: ${(metrics.errorRate * 100).toFixed(2)}%
    `);/*/
});


/*/function replaceVariables(content, state) {
    return content.replace(/{{([\w:.]+)}}/g, (match, path) => {
        const [type, key, field] = path.split(':');
        if (type === 'input' && state.userInswputs[key]) {
            return state.userInputs[key];
        } else if (type === 'api') {
            if (field && state.variables[`${key}_${field}`]) {
                return state.variables[`${key}_${field}`];
            } else if (state.apiResults[key]) {
                return JSON.stringify(state.apiResults[key]);
            }
        }else if (type === 'ai') {
            // Procura pela variável AI usando o shortId
            const aiValue = Object.entries(state.variables).find(([nodeId, value]) => nodeId.endsWith(key));
            if (aiValue) {
                return aiValue[1];
            }
        } else if (state.variables[key]) {
            return state.variables[key];
        }
        return match; // Retorna o placeholder original se não encontrar um valor
    });
}/*/

function replaceVariables(content, state) {
    if (typeof content !== 'string') {
        console.error('Content is not a string:', content);
        return content;
    }
    
    return content.replace(/{{([\w:.]+)}}/g, (match, path) => {
        const [type, key, field] = path.split(':');
        console.log('Replacing variable:', { type, key, field, state }); // Log para debug

        if (type === 'input' && state.userInputs && state.userInputs[key]) {
            return state.userInputs[key];
        } else if (type === 'api') {
            if (state.apiResults) {
                // Se não houver um key específico, procure em todos os resultados da API
                for (const apiKey in state.apiResults) {
                    if (state.apiResults[apiKey][field]) {
                        return state.apiResults[apiKey][field];
                    }
                }
            }
            return "Dados não encontrados";
        } else if (type === 'ai') {
            // Procura pela variável AI usando o shortId
            const aiValue = Object.entries(state.variables).find(([nodeId, value]) => nodeId.endsWith(key));
            if (aiValue) {
                return aiValue[1];
            } else if (type === 'nameExtractor') {
                // Procura diretamente no state.variables usando a chave completa
                const value = state.variables[key];
                console.log('Nome extraído:', value); // Debug
                return value || '';
            }
        } else if (state.variables && state.variables[key]) {
            return state.variables[key];
        }
        
        return match; // Retorna o placeholder original se não encontrar um valor
    });
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((prev, curr) => {
        return prev ? prev[curr] : undefined;
    }, obj);
}
function evaluateCondition(conditionNode, state) {
    console.log('Avaliando condição:', JSON.stringify(conditionNode, null, 2));
    console.log('Estado atual:', JSON.stringify(state, null, 2));

    let value;

    if (conditionNode.variable) {
        const [varType, varId] = conditionNode.variable.split(':');
        
        if (varType === 'input') {
            value = state.userInputs[varId];
        } else if (varType === 'api') {
            if (state.apiResults && state.apiResults[varId]) {
                value = state.apiResults[varId];
            }
        } else if (varType === 'ai') {
            // Procura pela variável AI usando o shortId
            const shortId = `AI_${varId.substr(-4)}`;
            value = state.variables[shortId];
        } else if (varType === 'nameExtractor') {
            // Procura pela variável de nome extraído
            value = state.variables[varId];
        }
    } else if (conditionNode.inputKey) {
        value = state.userInputs[conditionNode.inputKey];
    }

    if (value === undefined) {
        console.log(`Valor não encontrado para a condição: ${conditionNode.variable || conditionNode.inputKey}`);
        return false;
    }

    console.log(`Valor para comparação: "${value}"`);
    
    // Converta o valor e a condição para minúsculas para uma comparação insensível a maiúsculas/minúsculas
    const lowerValue = value.toString().toLowerCase();
    const lowerConditionValue = conditionNode.conditionValue ? conditionNode.conditionValue.toLowerCase() : '';

    switch (conditionNode.conditionType) {
        case 'equals':
            return lowerValue === lowerConditionValue;
        case 'contains':
            return lowerValue.includes(lowerConditionValue);
        case 'startsWith':
            return lowerValue.startsWith(lowerConditionValue);
        case 'endsWith':
            return lowerValue.endsWith(lowerConditionValue);
        case 'containsAny':
            if (Array.isArray(conditionNode.conditionValues)) {
                return conditionNode.conditionValues.some(val => 
                    lowerValue.includes(val.toLowerCase())
                );
            }
            return false;
        default:
            console.log(`Operador desconhecido: ${conditionNode.conditionType}`);
            return false;
    }
}




async function sendTextMessage(instance, content, delay, number) {
    const url = `${API_BASE_URL}/message/sendText/${instance}`;

    const data = JSON.stringify({
        number: number,
        text: content,
        // options
        delay: delay * 1000 || 1200,
        linkPreview: true
    });

    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': APIKEY
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log('Mensagem de texto enviada:')//, JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Erro ao enviar mensagem de texto:', error);
        throw error;
    }
}



const path = require('path');

async function sendMediaMessage(instanceKey, mediaUrl, number, mediaType, fileName, caption) {
    const url = `${API_BASE_URL}/message/sendMedia/${instanceKey}`;
    const data = JSON.stringify({
        number: number,
        mediatype: mediaType, // 'image', 'video', ou 'document'
        mimetype: getMimeType(mediaType),
        caption: caption,
        media: mediaUrl,
        fileName: fileName || `file.${getFileExtension(mediaType)}`
    });

    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': APIKEY
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log('Mídia enviada:')//, JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Erro ao enviar mídia:', error);
        throw error;
    }
}



async function sendAudioMessage(instanceKey, audioUrl, delay, number) {
    const url = `${API_BASE_URL}/message/sendWhatsAppAudio/${instanceKey}`;
    const data = JSON.stringify({
        number: number,
        audio: audioUrl,
        // options
        delay: delay * 1000 || 1200,
        encoding: true
    });

    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: url,
        headers: { 
            'Content-Type': 'application/json', 
            'apikey': APIKEY
        },
        data: data
    };

    try {
        const response = await axios.request(config);
        console.log('Áudio enviado:') //JSON.stringify(response.data));
        return response.data;
    } catch (error) {
        console.error('Erro ao enviar áudio:', error);
        throw error;
    }
}

function getMimeType(mediaType) {
    switch (mediaType) {
        case 'image':
            return 'image/png'; // ou 'image/jpeg'
        case 'video':
            return 'video/mp4';
        case 'document':
            return 'application/pdf'; // ajuste conforme necessário
        default:
            return 'application/octet-stream';
    }
}


function getFileExtension(mediaType) {
    switch (mediaType) {
        case 'image':
            return 'png'; // ou 'jpg'
        case 'video':
            return 'mp4';
        case 'document':
            return 'pdf';
        default:
            return 'bin';
    }
}
async function downloadMedia(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}


async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFile(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return new Blob([response.data]);
}

module.exports = { executeFunnel, sendTextMessage };