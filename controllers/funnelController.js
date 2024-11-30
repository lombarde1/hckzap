// controllers/funnelController.js
const redisClient = require('../config/redisConfig');
const { v4: uuidv4 } = require('uuid');

const PLAN_LIMITS = {
    gratuito: 1,
    basico: 2,
    plus: 25,
    premium: Infinity
};
const { logUserActivity, ActivityTypes } = require('../Helpers/activityHistoryHelpers');
const FUNNEL_EXPIRY = 60 * 60 * 24 * 30; // 30 dias em segundos

exports.deleteAllFunnels = async (req, res) => {
    try {
        const userId = req.user.id;
        const userKey = `user:${userId}`;
        const funnelsKey = `user:${userId}:funnels`;

        // Obter todos os IDs de funis do usuário
        const funnelIds = await redisClient.smembers(funnelsKey);

        // Deletar cada funil individualmente
        const deletionPromises = funnelIds.map(funnelId => 
            redisClient.del(`funnel:${funnelId}`)
        );

        // Executar todas as operações de deleção
        await Promise.all(deletionPromises);

        // Limpar o conjunto de IDs de funis do usuário
        await redisClient.del(funnelsKey);

        // Atualizar o contador de funis do usuário para zero
        await redisClient.hset(userKey, 'funnelCount', 0);

        res.json({ success: true, message: 'Todos os funis foram apagados com sucesso' });
    } catch (error) {
        console.error('Erro ao apagar todos os funis:', error);
        res.status(500).json({ error: 'Erro ao apagar todos os funis' });
    }
};


exports.downloadCommunityFunnel = async (req, res) => {
    try {
        const { id } = req.params;
        const communityFunnelKey = `community:funnel:${id}`;
        const funnelData = await redisClient.get(communityFunnelKey);

        if (!funnelData) {
            return res.status(404).json({ error: 'Funil da comunidade não encontrado' });
        }

        const funnel = JSON.parse(funnelData);

        // Incrementar o contador de downloads
        await redisClient.hincrby(communityFunnelKey, 'downloads', 1);

        // Remover campos sensíveis ou desnecessários antes de enviar
        const { _id, author, downloads, ...downloadableFunnel } = funnel;

        res.json(downloadableFunnel);
    } catch (error) {
        console.error('Erro ao baixar funil da comunidade:', error);
        res.status(500).json({ error: 'Erro ao baixar funil da comunidade' });
    }
};

exports.listFunnels = async (req, res) => {
    try {
        const userId = req.user.id;
        const funnelsKey = `user:${userId}:funnels`;
        const funnelIds = await redisClient.smembers(funnelsKey);

        const funnels = await Promise.all(funnelIds.map(async (funnelId) => {
            const funnelData = await redisClient.get(`funnel:${funnelId}`);
            return JSON.parse(funnelData);
        }));

        res.json(funnels);
    } catch (error) {
        console.error('Erro ao listar funis:', error);
        res.status(500).json({ message: 'Erro ao listar funis', error: error.message });
    }
};


exports.exportFunnel = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const funnelKey = `funnel:${id}`;
        const funnelData = await redisClient.get(funnelKey);

        if (!funnelData) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        const funnel = JSON.parse(funnelData);
        
        // Remover informações sensíveis ou específicas do usuário
        delete funnel.userId;
        delete funnel.createdAt;
        delete funnel.updatedAt;

        // Adicionar metadados de exportação
        funnel.exportedAt = new Date().toISOString();
        funnel.exportVersion = '1.0';

        res.json(funnel);
    } catch (error) {
        console.error('Erro ao exportar funil:', error);
        res.status(500).json({ error: 'Erro ao exportar funil' });
    }
};

exports.shareFunnel = async (req, res) => {
    try {
        const { funnelId, name, description, category, tags } = req.body;
        const userId = req.user.id;

        // Buscar o funil no Redis
        const funnelKey = `funnel:${funnelId}`;
        const funnelData = await redisClient.get(funnelKey);

        if (!funnelData) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        const funnel = JSON.parse(funnelData);

        // Criar um novo funil na comunidade
        const newCommunityFunnel = new CommunityFunnel({
            name,
            description,
            author: userId,
            nodes: funnel.nodes,
            connections: funnel.connections,
            category,
            tags
        });

        await newCommunityFunnel.save();

        res.status(201).json({ message: 'Funil compartilhado com sucesso', funnelId: newCommunityFunnel._id });
    } catch (error) {
        console.error('Erro ao compartilhar funil:', error);
        res.status(500).json({ error: 'Erro ao compartilhar funil' });
    }
};

exports.importFunnel = async (req, res) => {
    try {
        const { funnelData } = req.body;
        const userId = req.user.id;

        if (!funnelData || !funnelData.name || !funnelData.nodes || !funnelData.connections) {
            return res.status(400).json({ error: 'Dados do funil inválidos' });
        }

        const funnelId = uuidv4();
        const newFunnel = {
            ...funnelData,
            id: funnelId,
            userId: userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await redisClient.set(`funnel:${funnelId}`, JSON.stringify(newFunnel), 'EX', FUNNEL_EXPIRY);
        await redisClient.sadd(`user:${userId}:funnels`, funnelId);

        res.status(201).json({ message: 'Funil importado com sucesso', funnelId });
    } catch (error) {
        console.error('Erro ao importar funil:', error);
        res.status(500).json({ error: 'Erro ao importar funil' });
    }
};

exports.createFunnel = async (req, res) => {
    try {
        const { name, description } = req.body;
        const userId = req.user.id;

        const userKey = `user:${userId}`;
        const userPlan = await redisClient.hget(userKey, 'plan');
        const funnelsKey = `user:${userId}:funnels`;
        const funnelCount = await redisClient.scard(funnelsKey);

        if (userPlan !== 'premium' && funnelCount >= PLAN_LIMITS[userPlan]) {
            return res.status(403).json({
                message: 'Limite de funis atingido para o seu plano',
                currentPlan: userPlan,
                limit: PLAN_LIMITS[userPlan]
            });
        }

        const funnelId = uuidv4();
        const newFunnel = {
            id: funnelId,
            name,
            description,
            nodes: [],
            connections: [],
            createdAt: new Date().toISOString()
        };

        await redisClient.set(`funnel:${funnelId}`, JSON.stringify(newFunnel), 'EX', FUNNEL_EXPIRY);
        await redisClient.sadd(funnelsKey, funnelId);

        res.status(201).json(newFunnel);
    } catch (error) {
        console.error('Erro ao criar funil:', error);
        res.status(500).json({ message: 'Erro ao criar funil', error: error.message });
    }
};

exports.updateFunnel = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, nodes, connections } = req.body;
        const userId = req.user.id;

        const funnelKey = `funnel:${id}`;
        const updatedFunnel = {
            id,
            name,
            nodes,
            connections,
            updatedAt: new Date().toISOString()
        };

        await redisClient.set(funnelKey, JSON.stringify(updatedFunnel), 'EX', FUNNEL_EXPIRY);
        await logUserActivity(req.user.id, ActivityTypes.FUNNEL_EDIT, {
            funnelName: name,
            action: 'atualizado',
            changes: "editado!"
        });

        console.log(`Funil atualizado no Redis: ${id}`);
        res.json({ success: true, message: 'Funil atualizado com sucesso', funnel: updatedFunnel });
    } catch (error) {
        console.error('Erro ao atualizar funil:', error);
        res.status(500).json({ error: 'Erro ao atualizar funil' });
    }
};


exports.getFunnelById = async (funnelId, userId) => {
    try {
        const funnelKey = `funnel:${funnelId}`;
        const funnelData = await redisClient.get(funnelKey);

        if (!funnelData) {
            return null;
        }

        const funnel = JSON.parse(funnelData);
        
        // Verificar se o funil pertence ao usuário (opcional, dependendo da sua lógica de segurança)
        const userFunnelsKey = `user:${userId}:funnels`;
        const isFunnelOwner = await redisClient.sismember(userFunnelsKey, funnelId);
        
        if (!isFunnelOwner) {
            return null;
        }

        return funnel;
    } catch (error) {
        console.error('Erro ao buscar funil:', error);
        throw error;
    }
};


exports.deleteFunnel = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const funnelKey = `funnel:${id}`;
        const funnelsKey = `user:${userId}:funnels`;

        const deleted = await redisClient.del(funnelKey);
        if (deleted === 0) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        await redisClient.srem(funnelsKey, id);

        res.json({ message: 'Funil deletado com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar funil:', error);
        res.status(500).json({ error: 'Erro ao deletar funil' });
    }
};

exports.getFunnelDetails = async (req, res) => {
    try {
        const funnelId = req.params.id;
        const userId = req.user.id;

        // Verificar se o funil pertence ao usuário
        const userFunnelsKey = `user:${userId}:funnels`;
        const isFunnelOwner = await redisClient.sismember(userFunnelsKey, funnelId);

    
        if (isFunnelOwner && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Você não tem permissão para apagar este funil' });
        }
        
        // Buscar os detalhes do funil no Redis
        const funnelKey = `funnel:${funnelId}`;
        const funnelData = await redisClient.get(funnelKey);

        if (!funnelData) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        const funnel = JSON.parse(funnelData);

        // Retornar apenas os dados necessários para o frontend
        const funnelDetails = {
            id: funnel.id,
            name: funnel.name,
            description: funnel.description,
            category: funnel.category || '', // Assumindo que você tem uma categoria
            tags: funnel.tags || [], // Assumindo que você tem tags
            // Adicione outros campos relevantes aqui
        };

        res.json(funnelDetails);
    } catch (error) {
        console.error('Erro ao buscar detalhes do funil:', error);
        res.status(500).json({ error: 'Erro ao buscar detalhes do funil' });
    }
};

// Adicione ao funnelController.js

exports.updateFunnelName = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const userId = req.user.id;

        const funnelKey = `funnel:${id}`;
        
        // Verificar se o funil existe
        const existingFunnelData = await redisClient.get(funnelKey);
        if (!existingFunnelData) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        // Verificar se o funil pertence ao usuário
        const userFunnelsKey = `user:${userId}:funnels`;
        const isFunnelOwner = await redisClient.sismember(userFunnelsKey, id);
        if (!isFunnelOwner) {
            return res.status(403).json({ error: 'Você não tem permissão para editar este funil' });
        }

        const existingFunnel = JSON.parse(existingFunnelData);
        existingFunnel.name = name;
        existingFunnel.updatedAt = new Date().toISOString();

        // Salvar funil atualizado
        await redisClient.set(funnelKey, JSON.stringify(existingFunnel), 'EX', FUNNEL_EXPIRY);
        
        // Registrar atividade
        await logUserActivity(userId, ActivityTypes.FUNNEL_EDIT, {
            funnelName: name,
            action: 'nome atualizado',
            changes: `Nome alterado para: ${name}`
        });

        res.json({ 
            success: true, 
            message: 'Nome do funil atualizado com sucesso', 
            funnel: existingFunnel 
        });

    } catch (error) {
        console.error('Erro ao atualizar nome do funil:', error);
        res.status(500).json({ 
            success: false,
            error: 'Erro ao atualizar nome do funil',
            details: error.message 
        });
    }
};