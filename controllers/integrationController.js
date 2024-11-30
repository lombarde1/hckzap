const User = require('../models/User');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const PLAN_LIMITS = require('../config/planLimits');

// ... (manter as funções existentes)

// Função auxiliar para verificar se o usuário tem acesso a uma feature
function checkFeatureAccess(userPlan, feature) {
    return PLAN_LIMITS[userPlan][feature];
}

const mercadopago = require('mercadopago');

exports.getMercadoPagoAppStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const accessToken = user.mercadopago.appAccessToken;
        const hasAccess = checkFeatureAccess(user.plan, 'api') !== false;

        if (accessToken && hasAccess) {
            const maskedToken = maskAccessToken(accessToken);
            res.json({ configured: true, maskedToken, hasAccess });
        } else {
            res.json({ 
                configured: false, 
                hasAccess,
                message: hasAccess ? null : 'Seu plano atual não inclui acesso à API do Mercado Pago.'
            });
        }
    } catch (error) {
        console.error('Erro ao obter status do Mercado Pago App:', error);
        res.status(500).json({ error: 'Erro ao obter status' });
    }
};

function maskAccessToken(token) {
    if (token.length <= 6) return '******';
    return token.slice(0, 6) + '*'.repeat(token.length - 6);
}

exports.configureMercadoPagoApp = async (req, res) => {
    try {
        const { accessToken } = req.body;
        const userId = req.user.id;

        if (!checkFeatureAccess(req.user.plan, 'api')) {
            return res.status(403).json({ success: false, error: 'Seu plano não inclui acesso à API do Mercado Pago.' });
        }
        
        // Configurar o cliente Mercado Pago
        const client = new mercadopago.MercadoPagoConfig({ accessToken: accessToken });

        // Validar o token
        try {
            const paymentClient = new mercadopago.Payment(client);
            await paymentClient.search({ limit: 1 });
        } catch (error) {
            return res.status(400).json({ success: false, error: 'Token inválido' });
        }

        // Salvar o token no banco de dados
        await User.findByIdAndUpdate(userId, {
            'mercadopago.appAccessToken': accessToken
        });

        res.json({ success: true, message: 'Configuração salva com sucesso' });
    } catch (error) {
        console.error('Erro ao configurar Mercado Pago App:', error);
        res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
};

exports.testMercadoPagoApp = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const accessToken = user.mercadopago.appAccessToken;

        if (!accessToken) {
            return res.status(400).json({ success: false, error: 'Access Token não configurado' });
        }

        const client = new mercadopago.MercadoPagoConfig({ accessToken: accessToken });

        // Tenta criar um pagamento de teste
        const paymentClient = new mercadopago.Payment(client);
        const paymentData = {
            transaction_amount: 1.00, // Certifique-se de que este valor seja um número
            description: 'Teste de integração',
            payment_method_id: 'pix',
            payer: {
                email: 'test@test.com',
            }
        };

        const payment = await paymentClient.create({ body: paymentData });
console.log(payment)
        res.json({ success: true, message: 'Teste bem-sucedido', paymentId: payment.id });
    } catch (error) {
        console.error('Erro ao testar Mercado Pago App:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// Função para ler o arquivo JSON de tons
async function readTonsConfig() {
    const configPath = path.join(__dirname, '../config/tons-eleven.json');
    const rawData = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(rawData);
}


exports.checkElevenLabsConfig = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('elevenlabsApiKey elevenlabsVoiceId elevenlabsIntegrationActive plan');
        
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const hasAccess = checkFeatureAccess(user.plan, 'voiceGenerator');
        const isConfigured = !!(user.elevenlabsApiKey && user.elevenlabsVoiceId);
        const isActive = user.elevenlabsIntegrationActive;

        res.json({
            configured: isConfigured,
            active: isActive,
            hasAccess: hasAccess,
            message: isActive ? 'ElevenLabs está ativo e configurado' : 
                     isConfigured ? 'ElevenLabs está configurado, mas não testado' : 
                     'ElevenLabs não está configurado',
            planMessage: hasAccess ? null : 'Seu plano atual não inclui acesso ao gerador de voz.'
        });
    } catch (error) {
        console.error('Erro ao verificar configuração do ElevenLabs:', error);
        res.status(500).json({ error: 'Falha ao verificar configuração do ElevenLabs' });
    }
};

exports.saveMercadoPagoConfig = async (req, res) => {
    try {
        const { xCsrfToken, cookie, xNewRelicId } = req.body;

        // Validação básica
        if (!xCsrfToken || !cookie || !xNewRelicId) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Encontrar e atualizar o usuário
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            {
                'mercadopago.xCsrfToken': xCsrfToken,
                'mercadopago.cookie': cookie,
                'mercadopago.xNewRelicId': xNewRelicId,
                'mercadopago.integrationActive': true
            },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        res.status(200).json({
            message: 'Configuração do Mercado Pago salva com sucesso',
            config: {
                xCsrfToken: updatedUser.mercadopago.xCsrfToken,
                xNewRelicId: updatedUser.mercadopago.xNewRelicId,
                integrationActive: updatedUser.mercadopago.integrationActive
            }
        });
    } catch (error) {
        console.error('Erro ao salvar configuração do Mercado Pago:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao salvar a configuração' });
    }
};



exports.getMercadoPagoConfig = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('mercadopago');
        
        // Renderiza a view EJS com os dados
        res.render('mercadopago-integration', {
            user: req.user,
            mercadoPagoConfig: user.mercadopago || {}
        });
    } catch (error) {
        console.error('Erro ao buscar configuração do Mercado Pago:', error);
        res.status(500).render('error', { message: 'Falha ao buscar configuração do Mercado Pago' });
    }
};

exports.testMercadoPagoIntegration = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.mercadopago || !user.mercadopago.xCsrfToken || !user.mercadopago.cookie || !user.mercadopago.xNewRelicId) {
            return res.status(400).json({ error: 'Configuração do Mercado Pago incompleta' });
        }

        const response = await axios.get('https://www.mercadopago.com.br/activities/api/activities/list?period=last_two_weeks&page=1&listing=activities&useEmbeddings=true', {
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'sec-ch-ua': '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-csrf-token': user.mercadopago.xCsrfToken,
                'x-newrelic-id': user.mercadopago.xNewRelicId,
                'cookie': user.mercadopago.cookie,
                'Referer': 'https://www.mercadopago.com.br/activities/1?period=last_two_weeks',
                'Referrer-Policy': 'no-referrer-when-downgrade'
            }
        });

        res.json({
            success: true,
            data: response.data // Você pode querer filtrar ou limitar os dados retornados aqui
        });
    } catch (error) {
        console.error('Erro ao testar integração do Mercado Pago:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Falha ao testar integração do Mercado Pago' });
    }
};


exports.getActiveIntegrationsCount = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        let activeCount = 0;

        // Verificar ElevenLabs
        if (user.elevenlabsIntegrationActive) {
            activeCount++;
        }

        // Verificar Mercado Pago
        if (user.mercadopago && user.mercadopago.integrationActive) {
            activeCount++;
        }

        // Verificar Mercado Pago App
        if (user.mercadopago && user.mercadopago.appAccessToken) {
            activeCount++;
        }

        // Adicione mais verificações aqui para outras integrações, se necessário

        res.json({ activeIntegrations: activeCount });
    } catch (error) {
        console.error('Erro ao contar integrações ativas:', error);
        res.status(500).json({ error: 'Erro ao contar integrações ativas' });
    }
};

exports.getMercadoPagoStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('mercadopago plan');
        
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const hasAccess = checkFeatureAccess(user.plan, 'api');
        const isConfigured = !!(user.mercadopago && user.mercadopago.xCsrfToken && user.mercadopago.cookie && user.mercadopago.xNewRelicId);
        const isActive = user.mercadopago && user.mercadopago.integrationActive;

        res.json({
            configured: isConfigured,
            active: isActive,
            hasAccess: hasAccess,
            message: isActive ? 'Mercado Pago está ativo e configurado' : 
                     isConfigured ? 'Mercado Pago está configurado, mas não testado' : 
                     'Mercado Pago não está configurado',
            planMessage: hasAccess ? null : 'Seu plano atual não inclui acesso à API do Mercado Pago.'
        });
    } catch (error) {
        console.error('Erro ao verificar status do Mercado Pago:', error);
        res.status(500).json({ error: 'Falha ao verificar status do Mercado Pago' });
    }
};

exports.saveElevenLabsConfig = async (req, res) => {
    try {
        const { apiKey, voiceId } = req.body;
        const user = await User.findById(req.user.id);

        if (!checkFeatureAccess(user.plan, 'voiceGenerator')) {
            return res.status(403).json({ error: 'Seu plano não inclui acesso ao gerador de voz.' });
        }

        user.elevenlabsApiKey = apiKey;
        user.elevenlabsVoiceId = voiceId;
        await user.save();

        res.status(200).json({ message: 'Configuração do ElevenLabs salva com sucesso' });
    } catch (error) {
        console.error('Erro ao salvar configuração do ElevenLabs:', error);
        res.status(500).json({ error: 'Falha ao salvar configuração do ElevenLabs' });
    }
};

exports.getElevenLabsConfig = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('elevenlabsApiKey elevenlabsVoiceId');
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const tonsConfig = await readTonsConfig();

        res.json({
            elevenlabsApiKey: user.elevenlabsApiKey || '',
            elevenlabsVoiceId: user.elevenlabsVoiceId || '',
            tonsOptions: tonsConfig.map(ton => ({ nome: ton.nome, descricao: ton.descricao }))
        });
    } catch (error) {
        console.error('Erro ao buscar configuração do ElevenLabs:', error);
        res.status(500).json({ error: 'Falha ao buscar configuração do ElevenLabs' });
    }
};


// No seu integrationController.js, atualize o método getIntegrationStatus:
exports.getIntegrationStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const CartpandaConfig = require('../models/CartPandaConfig');
        const PushinPayConfig = require('../models/PushinPayConfig');

        const cartpandaConfig = await CartpandaConfig.findOne({ user: user.id });
        const pushinPayConfig = await PushinPayConfig.findOne({ user: user.id });

        const mpapp = Boolean(user.mercadopago?.appAccessToken);

        const integrationStatus = {
            elevenlabs: user.elevenlabsIntegrationActive,
            mercadopago: user.mercadopago && user.mercadopago.integrationActive,
            mercadopagoapp: mpapp,
            cartpanda: !!cartpandaConfig,
            pushinpay: !!pushinPayConfig && pushinPayConfig.isActive
        };

        res.json(integrationStatus);
    } catch (error) {
        console.error('Erro ao obter status das integrações:', error);
        res.status(500).json({ error: 'Erro ao obter status das integrações' });
    }
};

exports.testElevenLabsIntegration = async (req, res) => {
    try {
        const { text, tom } = req.body;
        const user = await User.findById(req.user.id);

        if (!checkFeatureAccess(user.plan, 'voiceGenerator')) {
            return res.status(403).json({ error: 'Seu plano não inclui acesso ao gerador de voz.' });
        }

        
        if (!user.elevenlabsApiKey || !user.elevenlabsVoiceId) {
            return res.status(400).json({ error: 'Configuração do ElevenLabs não encontrada' });
        }

        const tonsConfig = await readTonsConfig();
        const selectedTon = tonsConfig.find(t => t.nome === tom);
        if (!selectedTon) {
            return res.status(400).json({ error: 'Tom selecionado não encontrado' });
        }

        const options = {
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${user.elevenlabsVoiceId}`,
            headers: {
                'Accept': 'audio/mpeg',
                'xi-api-key': user.elevenlabsApiKey,
                'Content-Type': 'application/json'
            },
            data: {
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: `0.${selectedTon.estabilidade}`,
                    similarity_boost: `0.${selectedTon.similaridade}`,
                    style: `0.${selectedTon.exagero}`,
                    use_speaker_boost: selectedTon.boost
                }
            },
            responseType: 'arraybuffer'
        };

        const response = await axios(options);

        res.set('Content-Type', 'audio/mpeg');
        res.send(Buffer.from(response.data, 'binary'));

        user.elevenlabsIntegrationActive = true;
        await user.save();

    } catch (error) {
        console.error('Erro ao testar integração do ElevenLabs:', error);
        res.status(500).json({ error: 'Falha ao testar integração do ElevenLabs' });
    }
};

