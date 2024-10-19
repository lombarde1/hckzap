// Adicione esta função no início do arquivo ou em um arquivo de utilitários
const axios = require('axios');

const {avisar} = require('./avisos');

async function addUserToGroup(phone, instanceKey = 'darkadm') {
  const groupId = '120363270674663351@g.us';
  const apiUrl = `https://api.hocketzap.com/group/updateParticipant/${instanceKey}`;
  
  try {
    const response = await axios.post(apiUrl, {
      groupJid: groupId,
      action: 'add',
      participants: [phone]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'darkadm'
      }
    });

    if (response.data.updateParticipants && 
        response.data.updateParticipants[0] && 
        response.data.updateParticipants[0].status === "200") {
      console.log(`Usuário ${phone} adicionado ao grupo com sucesso.`);
      await avisar(phone, `Ja te adicionei ao grupo de suporte da plataforma ta bom? qualquer duvida so mandar mensagem la!`, instanceKey);
      await avisar(phone, `✅ E aqui estão alguns tutoriais de uso da plataforma:\n\nt.me/infohocketzap`, instanceKey);
      return true;
    } else {
      throw new Error('Falha ao adicionar ao grupo');
    }
  } catch (error) {
    console.error(`Erro ao adicionar usuário ao grupo: ${error.message}`);
    // Enviar link do grupo
    const groupLink = 'https://chat.whatsapp.com/E9x0eM5RkzxB2Vj1Dt5TnB';
    await avisar(phone, `Não foi possível adicionar você ao grupo de clientes automaticamente.\n\n Por favor, use este link para entrar: ${groupLink}`, instanceKey);
    return false;
  }

}

module.exports = {
    addUserToGroup
};