// redisHelpers.js
const redisClient = require('../config/redisConfig');

async function saveChat(instanceKey, chatId, chatData) {
    const key = `chat:${instanceKey}:${chatId}`;
    const exists = await redisClient.exists(key);
  
    if (!exists) {
      // Se o chat não existir, cria um novo
      await redisClient.hmset(key, {
        ...chatData,
        info: JSON.stringify(chatData.info || {})
      });
      await redisClient.sadd(`chats:${instanceKey}`, chatId);
    } else {
      // Se o chat já existir, atualiza os campos
      await redisClient.hmset(key, {
        name: chatData.name,
        image: chatData.image,
        info: JSON.stringify(chatData.info || {})
      });
    }
  }
  
  async function saveAndSendMessage(instanceKey, chatId, content) {
    const messageData = {
      key: `${chatId}:${Date.now()}`,
      sender: 'Hocketzap', // Você pode querer ajustar isso dependendo de como você identifica o remetente
      content: content,
      timestamp: Date.now(),
      fromMe: true,
      type: 'text'
    };
  
    await saveMessage(instanceKey, chatId, messageData);
  
    // Atualiza as informações do chat
    await updateChatInfo(instanceKey, chatId, { lastMessage: content }, messageData);
  
    return messageData;
  }

  async function chatExists(instanceKey, chatId) {
    const key = `chat:${instanceKey}:${chatId}`;
    return await redisClient.exists(key);
  }

  async function getChats(instanceKey) {
    const chatIds = await redisClient.smembers(`chats:${instanceKey}`);
    const chats = await Promise.all(
        chatIds.map(async (chatId) => {
            const chatData = await redisClient.hgetall(`chat:${instanceKey}:${chatId}`);
            return { 
                id: chatId, 
                ...chatData, 
                unreadCount: parseInt(chatData.unreadCount || '0')
            };
        })
    );
    return chats;
}

async function getMessages(instanceKey, chatId, limit = 50) {
  const key = `messages:${instanceKey}:${chatId}`;
  const messages = await redisClient.lrange(key, -limit, -1);
  return messages.map(JSON.parse);
}


async function saveMessage(instanceKey, chatId, messageData) {
  const chatKey = `chat:${instanceKey}:${chatId}`;
  const messagesKey = `messages:${instanceKey}:${chatId}`;
  const messageKeysSet = `messages:${instanceKey}:keys`;

  // Verifica se o chat existe
  const chatExists = await redisClient.exists(chatKey);

  if (!chatExists) {
      // Se o chat não existir, cria um novo com informações básicas
      await redisClient.hmset(chatKey, {
          name: messageData.sender,
          image: messageData.senderImage,
          info: JSON.stringify(messageData.info || {})
      });
      await redisClient.sadd(`chats:${instanceKey}`, chatId);
  }

  // Salva a mensagem na lista de mensagens do chat com expiração de 1 dia
  
  const ONE_MONTH_IN_SECONDS = 30 * 24 * 60 * 60; // 30 dias em segundos
  await redisClient.multi()
      .rpush(messagesKey, JSON.stringify(messageData))
      .expire(messagesKey, ONE_MONTH_IN_SECONDS)
      .exec();

  // Adiciona a chave da mensagem ao conjunto de chaves de mensagens com expiração de 1 dia
  await redisClient.multi()
      .sadd(messageKeysSet, messageData.key)
      .expire(messageKeysSet, ONE_MONTH_IN_SECONDS)
      .exec();

  // Atualiza a última mensagem no chat
  await redisClient.hmset(chatKey, {
      lastMessage: messageData.content,
      lastMessageTimestamp: messageData.timestamp,
      lastMessageType: messageData.type,
      fromMe: messageData.fromMe,
      quotedMessage: messageData.quotedMessage,
      quotedParticipant: messageData.quotedParticipant,
      info: JSON.stringify(messageData.info || {})
  });

  // Se a mensagem não é do usuário, marca o chat como não lido
  if (!messageData.fromMe) {
      await redisClient.hincrby(chatKey, 'unreadCount', 1);
      await redisClient.hset(chatKey, 'unread', 'true');
  }

  console.log(`Mensagem salva para o chat ${chatId}`.green);
  return true;
}

  
  async function messageExists(instanceKey, messageKey) {
    const messageKeysSet = `messages:${instanceKey}:keys`;
    return await redisClient.sismember(messageKeysSet, messageKey);
  }

  async function updateChatInfo(instanceKey, chatId, chatInfo, messageData) {
    const key = `chat:${instanceKey}:${chatId}`;

    if (!messageData.fromMe) {
        await redisClient.hmset(key, {
            name: chatInfo.name,
            chatType: chatInfo.chatType,
            info: JSON.stringify(chatInfo)
          });
    }

    
  }

  async function markChatAsRead(instanceKey, chatId) {
    
    const chatKey = `chat:${instanceKey}:${chatId}`;
    await redisClient.hset(chatKey, 'unread', '0');
    await redisClient.hset(chatKey, 'unreadCount', '0');
}
async function deleteChat2(instanceKey, chatId) {
  try {
    console.log(`🗑️ Deletando chat - Instance: ${instanceKey}, ChatId: ${chatId}`);
    
    const chatKey = `chat:${instanceKey}:${chatId}`;
    const messagesKey = `messages:${instanceKey}:${chatId}`;
    const chatsSetKey = `chats:${instanceKey}`;
    const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;

    // Verificar se o chat existe
    const exists = await redisClient.exists(chatKey);
    if (!exists) {
      console.log('❌ Chat não encontrado');
      return false;
    }

    // Deletar todas as chaves relacionadas
    const pipeline = redisClient.pipeline();
    pipeline.del(chatKey);
    pipeline.del(messagesKey);
    pipeline.del(autoResponseKey);
    pipeline.srem(chatsSetKey, chatId);

    const results = await pipeline.exec();
    console.log('✅ Resultados da deleção:', results);

    return true;
  } catch (error) {
    console.error('❌ Erro ao deletar chat:', error);
    throw error;
  }
}

async function deleteChat(instanceKey, chatId) {
  try {
    console.log(`Deletando chat - Instance: ${instanceKey}, ChatId: ${chatId}`);
    
    const pattern = `*${instanceKey}*${chatId}*`;
    const keys = await redisClient.keys(pattern);
    console.log('🔍 Chaves encontradas:', keys);

    if (keys.length === 0) {
      console.log('ℹ️ Nenhuma chave encontrada para este chat');
      return;
    }

    // Deletar o chat usando a função principal
    await deleteChat2(instanceKey, chatId);

    // Verificação adicional: deletar qualquer chave remanescente
    for (const key of keys) {
      const exists = await redisClient.exists(key);
      if (exists) {
        await redisClient.del(key);
        console.log(`🗑️ Chave adicional deletada: ${key}`);
      }
    }

    // Remover do conjunto de chats novamente para garantir
    await redisClient.srem(`chats:${instanceKey}`, chatId);

    // Verificação final
    const remainingKeys = await redisClient.keys(pattern);
    if (remainingKeys.length === 0) {
      console.log('\n✅ Limpeza concluída com sucesso! Nenhuma chave remanescente.');
    } else {
      console.log('\n⚠️ Aviso: Ainda existem chaves remanescentes:', remainingKeys);
    }

    console.log('Resultado da deleção:', result);
    return true;
  } catch (error) {
    console.error('Erro ao deletar chat no Redis:', error);
    throw error;
  }
}


async function clearChatMessages(instanceKey, chatId) {
  const messagesKey = `messages:${instanceKey}:${chatId}`;
  await redisClient.del(messagesKey);
  
  // Update the chat's last message info
  const chatKey = `chat:${instanceKey}:${chatId}`;
  await redisClient.hmset(chatKey, {
    lastMessage: '',
    lastMessageTimestamp: Date.now().toString(),
    lastMessageType: 'text',
    unreadCount: '0',
    unread: 'false'
  });
}


module.exports = {
    updateChatInfo,
    messageExists,
    markChatAsRead,
  saveChat,
  saveMessage,
  getChats,
  getMessages,
  chatExists,
  saveAndSendMessage,
  deleteChat,
  clearChatMessages
};