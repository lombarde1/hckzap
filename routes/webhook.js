const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { sendTextMessage } = require('../services/funnelExecutor');
const colors = require('colors');
const { saveMessage, messageExists, updateChatInfo } = require('../Helpers/redisHelpers');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require("axios")
const { uploadbase64 } = require('../Helpers/uploader');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getChats, chatExists } = require('../Helpers/redisHelpers');
const github = require('../config/git');
const redisClient = require('../config/redisConfig');
const {updateCampaigns, getCampaigns, getAutoResponseReport, getAutoResponseUsage, handleAutoResponse, handleButtonResponse} = require('../controllers/autoResponseController');


/*/async function getChatInfo(event, isGroup) {
  if (isGroup) {
    let retries = 0;
    const maxRetries = 3; // Número máximo de tentativas
    const delay = 1000; // Delay entre tentativas em ms

    while (retries < maxRetries) {
      try {
        const config = {
          method: 'get',
          maxBodyLength: Infinity,
          url: `https://api.hocketzap.com/group/fetchAllGroups/${event.instance}?getParticipants=false`,
          headers: { 
            'apikey': 'darkadm'
          }
        };

        const response = await axios.request(config);
        const groups = response.data;
        const currentGroup = groups.find(group => group.id === event.data.key.remoteJid);

        if (currentGroup) {
          // Se encontrou o grupo, atualiza no Redis
          const chatKey = `chat:${event.instance}:${event.data.key.remoteJid}`;
          try {
            await redisClient.hset(chatKey, {
              name: currentGroup.subject,
              chatType: 'grupo',
              info: JSON.stringify({
                name: currentGroup.subject,
                participants: currentGroup.size,
                chatType: 'grupo',
                owner: currentGroup.owner,
                creation: currentGroup.creation,
                desc: currentGroup.desc,
                restrict: currentGroup.restrict,
                announce: currentGroup.announce
              })
            });
          } catch (redisError) {
            console.error('Erro ao atualizar informações do grupo no Redis:', redisError);
          }

          return {
            userQueEnviou: event.data.pushName,
            name: currentGroup.subject,
            participants: currentGroup.size,
            chatType: 'grupo',
            owner: currentGroup.owner,
            creation: currentGroup.creation,
            desc: currentGroup.desc,
            restrict: currentGroup.restrict,
            announce: currentGroup.announce
          };
        }

        console.warn(`Grupo não encontrado para o JID: ${event.data.key.remoteJid}`);
        retries++;
        
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

      } catch (error) {
        console.error('Erro ao buscar informações do grupo (tentativa ${retries + 1}/${maxRetries}):', error);
        retries++;
        
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }

    // Se todas as tentativas falharam, tenta buscar do Redis
    try {
      const chatKey = `chat:${event.instance}:${event.data.key.remoteJid}`;
      const cachedInfo = await redisClient.hgetall(chatKey);
      
      if (cachedInfo && cachedInfo.name) {
        console.log('Usando informações em cache do Redis para o grupo');
        return {
          name: cachedInfo.name,
          chatType: 'grupo',
          info: JSON.parse(cachedInfo.info || '{}')
        };
      }
    } catch (redisError) {
      console.error('Erro ao buscar informações do grupo no Redis:', redisError);
    }

    // Se tudo falhar, retorna informação padrão
    return { 
      name: 'Grupo', 
      chatType: 'grupo',
      needsUpdate: true // Flag para indicar que precisa de atualização
    };
  } else {
    return {
      name: event.data.pushName || 'Usuário Desconhecido',
      chatType: 'individual'
    };
  }
}/*/

async function getChatInfo(event, isGroup) {
  if (isGroup) {
    return { 
      name: 'Grupo', 
      chatType: 'grupo'
    };
  } else {
    return {
      name: event.data.pushName || 'Usuário Desconhecido',
      chatType: 'individual'
    };
  }
}

router.post('/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await fulfillSubscription(session);
  }

  res.json({received: true});
});




const fs2 = require('fs')
const FormData = require('form-data');

async function sendMediaMessage(instanceKey, mediaUrl, id, filename, final, caption, type) {
  let url = `https://budzap.shop/message/${filename}?key=${instanceKey}`
  const mediaBuffer = await downloadMedia(mediaUrl);
  const data = new FormData();
  
  // Salvando o buffer temporariamente como um arquivo
  const tempFilePath = path.join(__dirname, 'temp_' + final);
  fs2.writeFileSync(tempFilePath, mediaBuffer);

  // Anexando o arquivo ao FormData
  data.append('file', fs2.createReadStream(tempFilePath), final);
  
  data.append('id', `${id}`);

  if (!final.includes('.mp3')) (
      data.append('caption', caption)
  )

  data.append('userType', type);
  data.append('delay', 0);

  try {
      const response = await axios.post(url, data, {
          headers: data.getHeaders()
      });
      
      if (response.data.error) {
          throw new Error(response.data.message);
      }
  } catch (error) {
      console.error('Error sending media message:', error);
  } finally {
      // Removendo o arquivo temporário
      fs2.unlinkSync(tempFilePath);
  }
}

async function downloadMedia(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}


const replaceNewLines = (text) => text.replace(/\n/g, ' ');




const chalk = require('chalk');

// Função para gerar cor única por instância
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

// Logger personalizado
const createLogger = (instance) => {
  const color = getInstanceColor(instance);
  return {
    info: (message) => console.log(chalk[color](`[${instance}][INFO] ${message}`)),
    error: (message) => console.log(chalk.red(`[${instance}][ERROR] ${message}`)),
    debug: (message) => console.log(chalk[color].dim(`[${instance}][DEBUG] ${message}`)),
    webhook: (message) => console.log(chalk[color].bold(`[${instance}][WEBHOOK] ${message}`))
  };
};

// No webhook.js, adicione o seguinte método
async function handleOwnerResponse(instanceKey, number, message) {
  const key = `maturation:waiting_response:${instanceKey}:${number}`;
  const isWaiting = await redisClient.get(key);

  if (isWaiting) {
      try {
          // Envia a última mensagem do processo
          await sendTextMessage(
              instanceKey,
              "Nao to te conseguindo enviar os prints aqui da ameaça dele, salva meu contato pra eu te enviar, acho que ta bugado",
              0, // sem delay
              number
          );

          // Remove o número da lista de espera
          await redisClient.del(key);
          
          // Registra que respondemos ao dono
          await redisClient.sadd('responded_owners', number);
          
          console.log(`Resposta final enviada para o dono ${number}`);
      } catch (error) {
          console.error(`Erro ao responder dono do grupo: ${error}`);
      }
  }
}


router.post('/evolution', async (req, res) => {
  const instance = req.body.instance;
  const logger = createLogger(instance);
  logger.webhook('Nova requisição webhook recebida');

  const io = req.app.get('io');

  try {
    const maxRetries = 5;
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        const user = await User.findOne({ 'whatsappInstances.name': instance });
        if (!user) {
          logger.error('Instância não encontrada');
          return res.status(404).json({ error: 'Instância não encontrada' });
        }

        const event = req.body;
        logger.debug(`Tipo de evento recebido: ${event.type}`);

        if (event.type === 'group-participants') {
          logger.info(`Evento de participantes do grupo detectado: ${event.body.data.action}`);
          if (event.body.data.action === "add") {
            const newMember = event.body.data.participants[0];
            const groupId = event.body.data.id;
            logger.info(`Novo membro adicionado ao grupo ${groupId}: ${newMember}`);

            try {
              const user = await User.findOne({ 'whatsappInstances.name': event.instance });
              if (user) {
                const instance = user.whatsappInstances.find(inst => inst.name === event.instance);
                logger.debug('Instância encontrada para mensagem de boas-vindas');

                if (instance && instance.welcomeMessage && instance.welcomeMessage.isActive) {
                  const { message, mediaType, mediaUrl, caption } = instance.welcomeMessage;
                  logger.info(`Enviando mensagem de boas-vindas para o grupo: ${groupId}`);

                  if (message) {
                    await sendTextMessage(event.instance, message.replace('{name}', newMember.split('@')[0]), groupId, 'group');
                    logger.debug('Mensagem de texto de boas-vindas enviada');
                  }

                  if (mediaType !== 'none' && mediaUrl) {
                    let typmed = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : '';
                    logger.debug(`Enviando mídia tipo: ${mediaType}`);

                    await sendMediaMessage(
                      event.instance,
                      mediaUrl,
                      groupId,
                      mediaType === 'image' ? 'imageFile' : 'video',
                      typmed,
                      caption ? caption.replace('{name}', newMember.split('@')[0]) : 'Usuario',
                      'group'
                    );
                    logger.debug('Mídia de boas-vindas enviada');
                  }
                }
              }
            } catch (error) {
              logger.error(`Erro ao enviar mensagem de boas-vindas: ${error.message}`);
            }
          }
        }

        const moment = require('moment-timezone');
        
        if (event.event === 'presence.update') {
          try {
              const { id: groupId, presences } = event.data;
              const memberId = Object.keys(presences)[0]; // Pega o ID do primeiro (e único) membro
              
           //   logger.debug(`Atualização de presença - Grupo: ${groupId}, Membro: ${memberId}`);
              
              if (!memberId || !presences[memberId]) {
                  logger.error('Dados de presença inválidos ou ausentes');
                  return;
              }
      
              const presence = presences[memberId].lastKnownPresence;
              const timestamp = moment(event.date_time).tz('America/Sao_Paulo').valueOf();
      
              io.to(event.instance).emit('presence update', {
                  chatId: memberId, // Usa o ID do membro ao invés do grupo
                  groupId: groupId, // Adiciona o ID do grupo como informação extra
                  presence: presence,
                  timestamp: timestamp
              });
          } catch (error) {
              logger.error(`Erro ao processar atualização de presença: ${error.message}`);
          }
      }

        if (event.event === 'messages.upsert') {
       logger.info(`Processando nova mensagem`);
          const isGroup = event.data.key.remoteJid.includes("@g.us");
          let chatInfo = await getChatInfo(event, isGroup);

       //   logger.debug(`Tipo de chat: ${isGroup ? 'grupo' : 'individual'}`);
          
          const dadoschat = {
            tipo: isGroup ? 'group' : 'individual',
            info: chatInfo,
            id: event.data.key.remoteJid,
            imagemPerfil: null,
            pushname: event.data.pushName,
            fromMe: event.data.key.fromMe,
            messageTimestamp: event.data.messageTimestamp,
            mensagem: {
              tipomsg: event.data.messageType,
              conteudomsg: null,
              quotedMessage: null,
              quotedParticipant: null
            },
            instancia: event.instance
          };

          if (event.data.contextInfo && event.data.contextInfo.quotedMessage) {
            logger.debug('Mensagem contém citação');
            dadoschat.mensagem.quotedMessage = event.data.contextInfo.quotedMessage.conversation;
            dadoschat.mensagem.quotedParticipant = event.data.contextInfo.participant;
          }

          // Função auxiliar para buscar funil do Redis
          async function getFunnelFromRedis(funnelId) {
            const funnelKey = `funnel:${funnelId}`;
            const funnelData = await redisClient.get(funnelKey);
            if (!funnelData) {
              logger.error(`Funil não encontrado no Redis: ${funnelId}`);
              return null;
            }
            return JSON.parse(funnelData);
          }

          // Função auxiliar para obter nó atual
          async function getCurrentNode(funnelId, nodeId) {
            try {
              const funnel = await getFunnelFromRedis(funnelId);
              if (!funnel) return null;
        //      logger.debug(`Buscando nó ${nodeId} do funil ${funnelId}`);
              return funnel.nodes.find(node => node.id === nodeId);
            } catch (error) {
          //    logger.error(`Erro ao buscar nó atual: ${error.message}`);
              return null;
            }
          }
          if (!isGroup) {
            const number = event.data.key.remoteJid.split('@')[0];
            await handleOwnerResponse(event.instance, number, dadoschat.mensagem.conteudomsg);
        }

          switch (event.data.messageType) {
            case 'buttonsResponseMessage':
              logger.info('Resposta de botão recebida');
              try {
                dadoschat.mensagem.tipomsg = 'button_response';
                dadoschat.mensagem.conteudomsg = event.data.message.buttonsResponseMessage.selectedDisplayText;
                
                const autoResponseKey = `auto_response:${event.instance}:${dadoschat.id}`;
                const stateData = await redisClient.get(autoResponseKey);

                if (stateData) {
                  const state = JSON.parse(stateData);
                  logger.debug(`Estado atual do funil: ${state.status}`);
                  
                  if (state.status === 'waiting_for_button') {
                    const currentNode = await getCurrentNode(state.funnelId, state.currentNodeId);
                    
                    if (currentNode && currentNode.type === 'button') {
                      const isValidResponse = currentNode.buttons.some(
                        button => button.displayText.toLowerCase() === dadoschat.mensagem.conteudomsg.toLowerCase()
                      );

                      if (isValidResponse) {
                        logger.info('Processando resposta válida do botão');
                        await handleButtonResponse(
                          event.instance,
                          dadoschat.id,
                          dadoschat.mensagem.conteudomsg,
                          state
                        );
                      }
                    }
                  }
                }
              } catch (error) {
                logger.error(`Erro ao processar resposta do botão: ${error.message}`);
              }
              break;

            case 'conversation':
              logger.debug('Mensagem de texto simples recebida');
              dadoschat.mensagem.tipomsg = 'texto';
              dadoschat.mensagem.conteudomsg = event.data.message.conversation;
              break;

            case 'extendedTextMessage':
              logger.debug('Mensagem de texto estendida recebida');
              dadoschat.mensagem.tipomsg = 'texto';
              dadoschat.mensagem.conteudomsg = event.data.message.extendedTextMessage.text;
              break;

            case 'reactionMessage':
              logger.debug('Reação recebida');
              dadoschat.mensagem.tipomsg = 'reaction';
              const targetMessageId = event.data.message.reactionMessage.key.id;
              const reaction = event.data.message.reactionMessage.text;
              dadoschat.mensagem.conteudomsg = `Mensagem '${targetMessageId}' reagida com ${reaction}`;
              break;

            case 'editedMessage':
              logger.debug('Mensagem editada recebida');
              const editedMsg = event.data.message.editedMessage.message.protocolMessage;
              dadoschat.mensagem.tipomsg = 'editada';
              dadoschat.mensagem.conteudomsg = `Mensagem '${editedMsg.key.id}' editada para ${editedMsg.editedMessage.conversation}`;
              break;

            case 'imageMessage':
              logger.debug('Imagem recebida');
              dadoschat.mensagem.tipomsg = 'image';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'image', github);
              break;

            case 'videoMessage':
              logger.debug('Vídeo recebido');
              dadoschat.mensagem.tipomsg = 'video';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, "video", github);
              break;

            case 'audioMessage':
              logger.debug('Áudio recebido');
              dadoschat.mensagem.tipomsg = 'audio';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'audio', github);
              break;

            case 'documentMessage':
              logger.debug('Documento recebido');
              dadoschat.mensagem.tipomsg = 'document';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, "document", github);
              break;

            case 'stickerMessage':
              logger.debug('Sticker recebido');
              dadoschat.mensagem.tipomsg = 'sticker';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'sticker', github);
              break;

            default:
              logger.debug(`Tipo de mensagem não suportado: ${event.data.messageType}`);
              dadoschat.mensagem.tipomsg = 'desconhecido';
              dadoschat.mensagem.conteudomsg = 'Tipo de mensagem não suportado';
              break;
          }

          logger.info(`Mensagem processada: ${dadoschat.mensagem.tipomsg}`);
          const messageKey = `${dadoschat.id}:${dadoschat.messageTimestamp}`;

          const isNewChat = await checkIfNewChat(event.instance, dadoschat.id);
          if (isNewChat) {
            logger.info(`Novo chat detectado: ${dadoschat.id}`);
            io.to(event.instance).emit('new chat', {
              id: dadoschat.id,
              name: chatInfo.name,
              lastMessage: dadoschat.mensagem.conteudomsg,
              lastMessageTimestamp: dadoschat.messageTimestamp,
              fromMe: dadoschat.fromMe,
              lastMessageType: dadoschat.mensagem.tipomsg,
              chatType: dadoschat.tipo,
              image: dadoschat.imagemPerfil,
              unreadCount: 1,
              quotedMessage: dadoschat.mensagem.quotedMessage,
              quotedParticipant: dadoschat.mensagem.quotedParticipant
            });
          }

          await saveMessage(event.instance, dadoschat.id, {
            key: messageKey,
            sender: dadoschat.pushname,
            info: chatInfo,
            content: dadoschat.mensagem.conteudomsg,
            timestamp: dadoschat.messageTimestamp,
            fromMe: dadoschat.fromMe,
            type: dadoschat.mensagem.tipomsg,
            senderImage: dadoschat.imagemPerfil,
            quotedMessage: dadoschat.mensagem.quotedMessage,
            quotedParticipant: dadoschat.mensagem.quotedParticipant
          });

          await updateChatInfo(event.instance, dadoschat.id, chatInfo, {
            key: messageKey,
            sender: dadoschat.pushname,
            info: chatInfo,
            content: dadoschat.mensagem.conteudomsg,
            timestamp: dadoschat.messageTimestamp,
            fromMe: dadoschat.fromMe,
            type: dadoschat.mensagem.tipomsg,
            senderImage: dadoschat.imagemPerfil,
            quotedMessage: dadoschat.mensagem.quotedMessage,
            quotedParticipant: dadoschat.mensagem.quotedParticipant
          });

          io.to(event.instance).emit('new message', {
            chatId: dadoschat.id,
            message: {
              key: messageKey,
              sender: dadoschat.pushname,
              info: chatInfo,
              content: dadoschat.mensagem.conteudomsg,
              timestamp: dadoschat.messageTimestamp,
              fromMe: dadoschat.fromMe,
              type: dadoschat.mensagem.tipomsg,
              senderImage: dadoschat.imagemPerfil,
              quotedMessage: dadoschat.mensagem.quotedMessage,
              quotedParticipant: dadoschat.mensagem.quotedParticipant
            }
          });

          // Iniciar a autoresposta
          if (!dadoschat.id.includes("@g.us")) {
            if(dadoschat.mensagem.tipomsg === 'button_response') {
              logger.debug('Ignorando autoresposta para resposta de botão');
              return;
            }
            logger.info('Iniciando processo de autoresposta');
            await handleAutoResponse(
              event.instance,
              dadoschat.id,
              dadoschat.mensagem.conteudomsg,
              "webhook"
            );
          }
        }

        async function checkIfNewChat(instanceKey, chatId) {
          logger.debug(`Verificando se é um novo chat: ${chatId}`);
          return !(await chatExists(instanceKey, chatId));
        }

        // Função auxiliar para lidar com a mídia
        async function handleMedia(mediaMessage) {
          logger.debug('Processando mídia recebida');
          if (mediaMessage.base64) {
            logger.debug('Mídia em formato base64 detectada');
            return mediaMessage.base64;
          }
          
          if (mediaMessage.url) {
            logger.debug(`Mídia em URL detectada: ${mediaMessage.url}`);
            return mediaMessage.url;
          }

          logger.error('Nenhum formato de mídia válido encontrado');
          return null;
        }

        success = true;
      //  logger.info('Evento processado com sucesso');
        res.status(200).send('Evento processado com sucesso');
      } catch (error) {
        retries++;
        logger.error(`Tentativa ${retries} falhou: ${error.message}`);
        if (retries >= maxRetries) {
          throw error;
        }
        logger.debug(`Aguardando 100ms antes da próxima tentativa`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    logger.error(`Erro fatal ao processar evento de webhook: ${error.message}`);
    logger.error(error.stack);
    res.status(500).json({ error: 'Erro ao processar evento de webhook' });
  }
});


router.post('/:instanceKey', async (req, res) => {
  try {
    const maxRetries = 5;
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        const user = await User.findOne({ 'whatsappInstances.name': req.params.instanceKey });
        if (!user) {
          return res.status(404).json({ error: 'Instância não encontrada' });
        }
console.log("Webhook recebido")
        const event = req.body;
        console.log(event)

        if (event.type === 'group-participants') {
          if (event.body.data.action === "add") {
              const newMember = event.body.data.participants[0];
              const groupId = event.body.data.id;
              console.log("Novo membro adicionado: " + newMember);
              try {
                  const user = await User.findOne({ 'whatsappInstances.name': event.instance });
                  if (user) {
                      const instance = user.whatsappInstances.find(inst => inst.name === event.instance);
                      console.log('Instância encontrada:', instance);
                      if (instance && instance.welcomeMessage && instance.welcomeMessage.isActive) {
                          const { message, mediaType, mediaUrl, caption } = instance.welcomeMessage;
                          console.log('Enviando mensagem de boas-vindas para o grupo:', groupId);
                          // Enviar mensagem de boas-vindas
                          if (message) {
                            await sendTextMessage(event.instance, message.replace('{name}', newMember.split('@')[0]), groupId, 'group');
                             
                          }
                          
                          // Enviar mídia, se configurada
                          if (mediaType !== 'none' && mediaUrl) {

                            let typmed;

                            if(mediaType == "image") {
                                typmed = "jpg"
                            } else if (mediaType == "video") {
                                typmed = "mp4"
                            }

                            await sendMediaMessage(
                              event.instance, 
                              mediaUrl, 
                              groupId, 
                              mediaType === 'image' ? 'imageFile' : 'video', 
                              typmed, 
                              caption ? caption.replace('{name}', newMember.split('@')[0]) : 'Usuario', 
                              'group'
                          );
                        }
                      }
                  }
              } catch (error) {
                  console.error('Erro ao enviar mensagem de boas-vindas:', error);
              }
          }
      }

  /*/if (event.event === 'messages.upsert') {
        console.log(`Processando webhook de mensagem para a instancia ${event.instance}`.cyan);
      
        const isGroup = event.data.key.remoteJid.includes("@g.us");
        let chatInfo = await getChatInfo(event, isGroup);
      
        const dadoschat = {
          tipo: isGroup ? 'group' : 'individual',
          info: chatInfo,
          id: event.data.key.remoteJid,
          imagemPerfil: null, // Não temos essa informação na nova estrutura
          pushname: event.data.pushName,
          fromMe: event.data.key.fromMe,
          messageTimestamp: event.data.messageTimestamp,
          mensagem: {
            tipomsg: event.data.messageType,
            conteudomsg: null,
          },
          instancia: event.instance
        };
      
        switch (event.data.messageType) {
          case 'conversation':
            dadoschat.mensagem.tipomsg = 'texto';
            dadoschat.mensagem.conteudomsg = event.data.message.conversation;
            break;
      
            case 'extendedTextMessage':
              dadoschat.mensagem.tipomsg = 'texto';
              dadoschat.mensagem.conteudomsg = event.data.message.extendedTextMessage.text;
              break
    
            case 'imageMessage':
              dadoschat.mensagem.tipomsg = 'image';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'image', github);
              break
            case 'videoMessage':
              dadoschat.mensagem.tipomsg = 'video';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, "video", github);
              break
            case 'audioMessage':
              dadoschat.mensagem.tipomsg = 'audio';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'audio', github);
              break
            case 'documentMessage':
              dadoschat.mensagem.tipomsg = 'document';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, "document", github);
              break;
            case 'stickerMessage':
              dadoschat.mensagem.tipomsg = 'sticker';
              dadoschat.mensagem.conteudomsg = await uploadbase64(event.data.message.base64, 'sticker', github);
              break;


          default:
            dadoschat.mensagem.tipomsg = 'desconhecido';
            dadoschat.mensagem.conteudomsg = 'Tipo de mensagem não suportado';
            break;
        }
      
        console.log("Mensagem recebida: ", dadoschat.mensagem.conteudomsg);
      
        const messageKey = `${dadoschat.id}:${dadoschat.messageTimestamp}`;
      
        const io = req.app.get('io');
        const isNewChat = await checkIfNewChat(event.instance, dadoschat.id);
        if (isNewChat) {
          console.log(`Novo chat detectado: ${dadoschat.id}`);
      
          io.to(event.instance).emit('new chat', {
            id: dadoschat.id,
            name: chatInfo.name,
            lastMessage: dadoschat.mensagem.conteudomsg,
            lastMessageTimestamp: dadoschat.messageTimestamp,
            lastMessageType: dadoschat.mensagem.tipomsg,
            chatType: dadoschat.tipo,
            image: dadoschat.imagemPerfil,
            unreadCount: 1
          });
        }
      
        await saveMessage(event.instance, dadoschat.id, {
          key: messageKey,
          sender: dadoschat.pushname,
          info: chatInfo,
          content: dadoschat.mensagem.conteudomsg,
          timestamp: dadoschat.messageTimestamp,
          fromMe: dadoschat.fromMe,
          type: dadoschat.mensagem.tipomsg,
          senderImage: dadoschat.imagemPerfil
        });
      
        await updateChatInfo(event.instance, dadoschat.id, chatInfo, {
          key: messageKey,
          sender: dadoschat.pushname,
          info: chatInfo,
          content: dadoschat.mensagem.conteudomsg,
          timestamp: dadoschat.messageTimestamp,
          fromMe: dadoschat.fromMe,
          type: dadoschat.mensagem.tipomsg,
          senderImage: dadoschat.imagemPerfil
        });
      
        io.to(event.instance).emit('new message', {
          chatId: dadoschat.id,
          message: {
            key: messageKey,
            sender: dadoschat.pushname,
            info: chatInfo,
            content: dadoschat.mensagem.conteudomsg,
            timestamp: dadoschat.messageTimestamp,
            fromMe: dadoschat.fromMe,
            type: dadoschat.mensagem.tipomsg,
            senderImage: dadoschat.imagemPerfil
          }
        });
      
        // Iniciar a autoresposta
  const {updateCampaigns, getCampaigns, getAutoResponseReport, getAutoResponseUsage, handleAutoResponse} = require('../controllers/autoResponseController');


        if (!dadoschat.id.includes("@g.us")) {
          await handleAutoResponse(
            event.instance,
            dadoschat.id,
            dadoschat.mensagem.conteudomsg,
            "webhook"
          );
        }
      }/*/
      
      async function checkIfNewChat(instanceKey, chatId) {
        return !(await chatExists(instanceKey, chatId));
      }
      
      // Função auxiliar para lidar com a mídia (imagem, áudio, vídeo, sticker)
      async function handleMedia(mediaMessage) {
        // Se a mídia estiver em base64, você pode retorná-la diretamente
        if (mediaMessage.base64) {
          return mediaMessage.base64;
        }
        
        // Se a mídia estiver em uma URL, você pode baixá-la aqui
        if (mediaMessage.url) {
          // Implemente a lógica para baixar a mídia da URL
          // Retorne o conteúdo baixado ou a URL, dependendo de como você quer lidar com isso
          return mediaMessage.url;
        }
      
        // Se não houver base64 nem URL, retorne null ou uma mensagem de erro
        return null;
      }
        success = true;
        console.log(`Evento processado com sucesso para a instância ${req.params.instanceKey}`.green);
        res.status(200).send('Evento processado com sucesso');
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // espera 100ms antes de tentar novamente
      }
    }
  } catch (error) {
    console.error('Erro ao processar evento de webhook:', error);
    res.status(500).json({ error: 'Erro ao processar evento de webhook' });
  }
});

module.exports = router;