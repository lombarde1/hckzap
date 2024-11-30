const User = require('../models/User');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const apiController = {
    // Renderiza a página de documentação da API
    renderApiDocs: async (req, res) => {
        try {
            const user = await User.findById(req.user.id);
            res.render('api-docs', {
                user: req.user,
                apiKey: user.apiKey || null,
                title: 'Documentação da API'
            });
        } catch (error) {
            console.error('Erro ao renderizar documentação:', error);
            res.status(500).render('error', { message: 'Erro ao carregar documentação da API' });
        }
    },

    // Gera uma nova API key para o usuário
    generateApiKey: async (req, res) => {
        try {
            const apiKey = `hkt_${uuidv4().replace(/-/g, '')}`;
            
            await User.findByIdAndUpdate(req.user.id, {
                $set: {
                    apiKey: apiKey,
                    apiKeyCreatedAt: new Date()
                }
            });

            res.json({ success: true, apiKey });
        } catch (error) {
            console.error('Erro ao gerar API key:', error);
            res.status(500).json({ success: false, error: 'Erro ao gerar API key' });
        }
    },

    // Revoga a API key atual do usuário
    revokeApiKey: async (req, res) => {
        try {
            await User.findByIdAndUpdate(req.user.id, {
                $unset: { 
                    apiKey: "",
                    apiKeyCreatedAt: ""
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Erro ao revogar API key:', error);
            res.status(500).json({ success: false, error: 'Erro ao revogar API key' });
        }
    },

    // Testa a conexão com a API
    testApiConnection: async (req, res) => {
        const apiKey = req.headers['x-api-key'];
        
        try {
            const user = await User.findOne({ apiKey });
            
            if (!user) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'API key inválida' 
                });
            }

            res.json({
                success: true,
                message: 'Conexão estabelecida com sucesso',
                user: {
                    name: user.name,
                    plan: user.plan
                }
            });
        } catch (error) {
            console.error('Erro ao testar conexão:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Erro ao testar conexão com a API' 
            });
        }
    },

    // Verifica uso da API
    getApiUsage: async (req, res) => {
        try {
            const user = await User.findById(req.user.id);
            
            // Aqui você pode implementar a lógica para tracking de uso da API
            const usage = {
                totalRequests: 0, // Implementar contador
                lastRequest: user.lastApiRequest || null,
                plan: user.plan,
                limits: {
                    messagesPerDay: 1000, // Ajustar baseado no plano
                    requestsPerMinute: 60
                }
            };

            res.json(usage);
        } catch (error) {
            console.error('Erro ao obter uso da API:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Erro ao obter estatísticas de uso' 
            });
        }
    }
};

module.exports = apiController;