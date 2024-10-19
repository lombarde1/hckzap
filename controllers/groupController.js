// groupController.js

const axios = require('axios');

const BASE_URL = 'https://api.hocketzap.com';
const API_KEY = 'darkadm';

// Configuração padrão para todas as requisições
const axiosConfig = {
  headers: {
    'Content-Type': 'application/json',
    'apikey': API_KEY
  }
};

const groupController = {
  // Criar um grupo
  createGroup: async (req, res) => {
    const { instance } = req.params;
    const { subject, description, participants } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/create/${instance}`, {
        subject,
        description,
        participants
      }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao criar grupo' });
    }
  },

  // Atualizar a imagem do grupo
  updateGroupPicture: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { image } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/updateGroupPicture/${instance}?groupJid=${groupJid}`, { image }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao atualizar imagem do grupo' });
    }
  },

  // Atualizar o assunto do grupo
  updateGroupSubject: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { subject } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/updateGroupSubject/${instance}?groupJid=${groupJid}`, { subject }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao atualizar assunto do grupo' });
    }
  },

  // Atualizar a descrição do grupo
  updateGroupDescription: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { description } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/updateGroupDescription/${instance}?groupJid=${groupJid}`, { description }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao atualizar descrição do grupo' });
    }
  },

  // Buscar código de convite
  fetchInviteCode: async (req, res) => {
    const { instance, groupJid } = req.params;

    try {
      const response = await axios.get(`${BASE_URL}/group/inviteCode/${instance}?groupJid=${groupJid}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao buscar código de convite' });
    }
  },

  // Revogar código de convite
  revokeInviteCode: async (req, res) => {
    const { instance, groupJid } = req.params;

    try {
      const response = await axios.post(`${BASE_URL}/group/revokeInviteCode/${instance}?groupJid=${groupJid}`, {}, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao revogar código de convite' });
    }
  },

  // Enviar convite por URL
  sendInviteUrl: async (req, res) => {
    const { instance } = req.params;
    const { groupJid, description, numbers } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/sendInvite/${instance}`, {
        groupJid,
        description,
        numbers
      }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao enviar convite' });
    }
  },

  // Buscar grupo por código de convite
  findGroupByInviteCode: async (req, res) => {
    const { instance, inviteCode } = req.params;

    try {
      const response = await axios.get(`${BASE_URL}/group/inviteInfo/${instance}?inviteCode=${inviteCode}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao buscar grupo por código de convite' });
    }
  },

  // Buscar grupo por JID
  findGroupByJid: async (req, res) => {
    const { instance, groupJid } = req.params;

    try {
      const response = await axios.get(`${BASE_URL}/group/findGroupInfos/${instance}?groupJid=${groupJid}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao buscar grupo por JID' });
    }
  },

  // Buscar todos os grupos
  fetchAllGroups: async (req, res) => {
    const { instance } = req.params;
    const { getParticipants } = req.query;

    try {
      const response = await axios.get(`${BASE_URL}/group/fetchAllGroups/${instance}?getParticipants=${getParticipants}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao buscar todos os grupos' });
    }
  },

  // Buscar participantes
  findParticipants: async (req, res) => {
    const { instance, groupJid } = req.params;

    try {
      const response = await axios.get(`${BASE_URL}/group/participants/${instance}?groupJid=${groupJid}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao buscar participantes' });
    }
  },

  // Atualizar participante
  updateParticipant: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { action, participants } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/updateParticipant/${instance}?groupJid=${groupJid}`, {
        action,
        participants
      }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao atualizar participante' });
    }
  },

  // Atualizar configurações
  updateSetting: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { action } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/updateSetting/${instance}?groupJid=${groupJid}`, { action }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao atualizar configurações' });
    }
  },

  // Alternar mensagens efêmeras
  toggleEphemeral: async (req, res) => {
    const { instance, groupJid } = req.params;
    const { expiration } = req.body;

    try {
      const response = await axios.post(`${BASE_URL}/group/toggleEphemeral/${instance}?groupJid=${groupJid}`, { expiration }, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao alternar mensagens efêmeras' });
    }
  },

  // Sair do grupo
  leaveGroup: async (req, res) => {
    const { instance, groupJid } = req.params;

    try {
      const response = await axios.delete(`${BASE_URL}/group/leaveGroup/${instance}?groupJid=${groupJid}`, axiosConfig);
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ error: error.response?.data || 'Erro ao sair do grupo' });
    }
  }
};

module.exports = groupController;