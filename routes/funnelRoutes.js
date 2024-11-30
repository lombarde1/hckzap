// routes/funnelRoutes.js

const express = require('express');
const router = express.Router();
const funnelController = require('../controllers/funnelController');
const { ensureAuthenticated } = require('../middleware/auth');
const User = require('../models/User'); // Assegure-se de que o caminho para o modelo User está correto
const redisClient = require('../config/redisConfig');
const { getActiveFunnels } = require('../utils/funnelHelper');
const communityFunnelController = require('../controllers/communityFunnelController');

// Rota para a página de listagem de funis
router.get('/', ensureAuthenticated, (req, res) => {
    res.render('funnels', { title: 'Funil', user: req.user });
});

const aiController = require('../controllers/aiController');

// ...

router.post('/api/create-ai-funnel', ensureAuthenticated, aiController.createAIFunnel);

router.post('/api/community/purchase/:funnelId', ensureAuthenticated, communityFunnelController.initiatePurchase);


router.get('/status', async (req, res) => {
    try {
        const { funnelId, instanceKey, chatId } = req.query;
        const userId = req.user.id;

        // Buscar o funil do Redis
        const funnel = await funnelController.getFunnelById(funnelId, userId);

        if (!funnel) {
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        const autoResponseKey = `auto_response:${instanceKey}:${chatId}`;
        const stateData = await redisClient.get(autoResponseKey);
        const state = stateData ? JSON.parse(stateData) : null;

        let currentContent = { type: 'text', value: 'Conteúdo não disponível' };
        let currentNode = null;
        if (state && state.currentNodeId) {
            currentNode = funnel.nodes.find(node => node.id === state.currentNodeId);
            if (currentNode) {
                switch (currentNode.type) {
                    case 'message':
                        currentContent = { type: 'text', value: currentNode.data.message };
                        break;
                    case 'image':
                        currentContent = { type: 'image', value: currentNode.data.imageUrl };
                        break;
                    case 'video':
                        currentContent = { type: 'video', value: currentNode.data.videoUrl };
                        break;
                    case 'audio':
                        currentContent = { type: 'audio', value: currentNode.data.audioUrl };
                        break;
                    case 'input':
                        currentContent = { type: 'text', value: currentNode.data.question };
                        break;
                }
            }
        }

        const response = {
            totalNodes: funnel.nodes.length,
            currentNodeIndex: currentNode ? funnel.nodes.indexOf(currentNode) + 1 : 0,
            hasInput: funnel.nodes.some(node => node.type === 'input'),
            waitingForInput: state ? state.status === 'waiting_for_input' : false,
            status: state ? state.status : 'not_started',
            currentContent: currentContent
        };

        res.json(response);
    } catch (error) {
        console.error('Erro ao obter status do funil:', error);
        res.status(500).json({ error: 'Erro ao obter status do funil' });
    }
});

router.get('/buscar/:id', ensureAuthenticated, async (req, res) => {
    const funnelId = req.params.id;
       console.log(funnelId)
        const funnel = await funnelController.getFunnelById(funnelId, req.user.id);
       console.log(funnel)
        res.json(funnel)
})

router.get('/editor/:id', ensureAuthenticated, async (req, res) => {
    try {
        const funnelId = req.params.id;
        if (!funnelId) {
            return res.status(400).render('error', { message: 'ID do funil não fornecido' });
        }
        const funnel = await funnelController.getFunnelById(funnelId, req.user.id);
        if (!funnel) {
            return res.status(404).render('error', { message: 'Funil não encontrado', layout: false });
        }
        res.render('funnel-editor', { funnel: funnel, user: req.user,  layout: false  });
    } catch (error) {
        console.error('Erro ao carregar o funil:', error);
        res.status(500).render('error', { message: 'Erro ao carregar o funil' });
    }
});
// Rotas API
router.delete('/api/delete-all', ensureAuthenticated, funnelController.deleteAllFunnels);

router.get('/user-funnels', ensureAuthenticated, async (req, res) => {
    try {
    
        const userId = req.user.id;
        const userKey = `user:${userId}`;
        const funnelsKey1 = `user:${userId}:funnels`;

        // Obter todos os IDs de funis do usuário
        const funnelKeys = await redisClient.smembers(funnelsKey1);

        const funnels = await Promise.all(funnelKeys.map(async (key) => {
            const funnelData = await redisClient.get(key);
            return JSON.parse(funnelData);
        }));

        res.json(funnels);
    } catch (error) {
        console.error('Erro ao buscar funis do usuário:', error);
        res.status(500).json({ error: 'Erro ao buscar funis do usuário' });
    }
});

router.get('/api/list', ensureAuthenticated, funnelController.listFunnels);
router.post('/api/create', ensureAuthenticated, funnelController.createFunnel);
router.put('/api/update/:id', ensureAuthenticated, funnelController.updateFunnel);
router.delete('/api/delete/:id', ensureAuthenticated, funnelController.deleteFunnel);



// Exportação e importação
router.get('/api/export/:id', ensureAuthenticated, funnelController.exportFunnel);
router.post('/api/import', ensureAuthenticated, funnelController.importFunnel);
// Adicione em funnelRoutes.js

router.patch('/api/update-name/:id', ensureAuthenticated, funnelController.updateFunnelName);

router.get('/community', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.user.id;
        const userKey = `user:${userId}`;
        const funnelsKey = `user:${userId}:funnels`;

        const [userPlan, funnelIds] = await Promise.all([
            redisClient.hget(userKey, 'plan'),
            redisClient.smembers(funnelsKey)
        ]);

        const funnelsPromises = funnelIds.map(funnelId => 
            redisClient.get(`funnel:${funnelId}`).then(JSON.parse)
        );
        const funnels = await Promise.all(funnelsPromises);

        const activeFunnels = getActiveFunnels(funnels, userPlan);

        res.render('community-funnels', {
            user: req.user,
            funnels: activeFunnels,
            title: 'Comunidade de Funis'
        });
    } catch (error) {
        console.error('Erro ao carregar funis do usuário:', error);
        res.status(500).render('error', { message: 'Erro ao carregar funis do usuário' });
    }
});


router.get('/api/community/list', ensureAuthenticated, communityFunnelController.listCommunityFunnels);
router.post('/api/community/share', ensureAuthenticated, communityFunnelController.shareFunnel);
router.get('/api/community/download/:id', ensureAuthenticated, communityFunnelController.downloadCommunityFunnel);
router.post('/api/community/comment/:id', ensureAuthenticated, communityFunnelController.addComment);
router.get('/api/community/categories', ensureAuthenticated, communityFunnelController.getCategories);
router.get('/api/community/comments/:id', ensureAuthenticated, communityFunnelController.getComments);
router.post('/api/community/add-to-user/:id', ensureAuthenticated, communityFunnelController.addToUserFunnels);
router.get('/api/details/:id', ensureAuthenticated, funnelController.getFunnelDetails);
router.post('/api/community/like/:id', ensureAuthenticated, communityFunnelController.likeFunnel);
router.get('/api/community/my-posts', ensureAuthenticated, communityFunnelController.getMyPosts);
router.get('/api/community/liked-posts', ensureAuthenticated, communityFunnelController.getLikedPosts);
router.delete('/api/community/delete/:id', ensureAuthenticated, communityFunnelController.deleteFunnel);

module.exports = router;