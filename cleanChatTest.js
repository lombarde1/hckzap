// cleanChatTest.js
require('dotenv').config();
const Redis = require('ioredis');

// Criar nova conexão Redis
const redisClient = new Redis({
    host: '147.79.111.143',
    port: 6379,
    password: 'darklindo',
});

const targetNumber = '5517991134416@s.whatsapp.net';
const instanceKey = 'darkadm';

async function deleteChat(instanceKey, chatId) {
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

async function cleanChat() {
  try {
    console.log('\n🚀 Iniciando limpeza do chat...');
    console.log(`📱 Número alvo: ${targetNumber}`);
    console.log(`🔑 Instância: ${instanceKey}\n`);

    // Listar todas as chaves relacionadas ao chat
    const pattern = `*${instanceKey}*${targetNumber}*`;
    const keys = await redisClient.keys(pattern);
    console.log('🔍 Chaves encontradas:', keys);

    if (keys.length === 0) {
      console.log('ℹ️ Nenhuma chave encontrada para este chat');
      return;
    }

    // Deletar o chat usando a função principal
    await deleteChat(instanceKey, targetNumber);

    // Verificação adicional: deletar qualquer chave remanescente
    for (const key of keys) {
      const exists = await redisClient.exists(key);
      if (exists) {
        await redisClient.del(key);
        console.log(`🗑️ Chave adicional deletada: ${key}`);
      }
    }

    // Remover do conjunto de chats novamente para garantir
    await redisClient.srem(`chats:${instanceKey}`, targetNumber);

    // Verificação final
    const remainingKeys = await redisClient.keys(pattern);
    if (remainingKeys.length === 0) {
      console.log('\n✅ Limpeza concluída com sucesso! Nenhuma chave remanescente.');
    } else {
      console.log('\n⚠️ Aviso: Ainda existem chaves remanescentes:', remainingKeys);
    }

  } catch (error) {
    console.error('\n❌ Erro durante a limpeza:', error);
  } finally {
    // Fechar conexão Redis de forma segura
    console.log('\n👋 Fechando conexão com Redis...');
    await redisClient.quit();
  }
}

// Executar limpeza com tratamento de erro
cleanChat()
  .then(() => {
    console.log('\n🏁 Script finalizado com sucesso');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n💥 Erro fatal:', err);
    if (redisClient.status === 'ready') {
      await redisClient.quit();
    }
    process.exit(1);
  });

// Tratamento de erros não capturados
process.on('unhandledRejection', async (err) => {
  console.error('\n🚨 Erro não tratado:', err);
  if (redisClient.status === 'ready') {
    await redisClient.quit();
  }
  process.exit(1);
});