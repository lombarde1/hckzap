const express = require('express');
const router = express.Router(); // Criar o router
const HocketLink = require('../models/HocketLink');
const axios = require('axios');
const rateLimiter = require('../middleware/rateLimiter');
const useragent = require('express-useragent');
// Middleware para detectar informações do usuário
router.use(useragent.express());
router.use(rateLimiter);

// Função para selecionar o número baseado no tipo de redirecionamento
async function selectNumber(link) {
    const activeNumbers = link.numbers.filter(n => n.isActive);
    if (activeNumbers.length === 0) return null;

    if (link.redirectType === 'random') {
        // Seleção aleatória
        const randomIndex = Math.floor(Math.random() * activeNumbers.length);
        return activeNumbers[randomIndex].whatsappNumber;
    } else if (link.redirectType === 'rotative') {
        // Seleção rotativa
        const nextIndex = (link.lastUsedIndex + 1) % activeNumbers.length;
        
        // Atualizar o índice no banco de dados
        await HocketLink.findByIdAndUpdate(link._id, {
            lastUsedIndex: nextIndex
        });

        return activeNumbers[nextIndex].whatsappNumber;
    }

    return activeNumbers[0].whatsappNumber;
}

// Função para registrar o redirecionamento
async function logRedirect(link, selectedNumber, req) {
    const redirectInfo = {
        timestamp: new Date(),
        number: selectedNumber,
        userAgent: req.useragent.source,
        ip: req.ip,
        referrer: req.get('referrer') || 'direct',
        device: {
            isMobile: req.useragent.isMobile,
            isDesktop: req.useragent.isDesktop,
            isBot: req.useragent.isBot,
            browser: req.useragent.browser,
            os: req.useragent.os,
            platform: req.useragent.platform
        }
    };

    await HocketLink.findByIdAndUpdate(link._id, {
        $inc: { 'stats.clicks': 1 },
        $set: { 'stats.lastClick': new Date() },
        $push: {
            'stats.redirectHistory': {
                $each: [redirectInfo],
                $position: 0,
                $slice: 1000 // Manter apenas os últimos 1000 registros
            }
        }
    });

    return redirectInfo;
}

// Função para formatar mensagem do WhatsApp
function formatWhatsAppMessage(message, data = {}) {
    let formattedMessage = message;
    
    // Substituir placeholders
    Object.entries(data).forEach(([key, value]) => {
        formattedMessage = formattedMessage.replace(new RegExp(`{${key}}`, 'g'), value);
    });

    // Adicionar data/hora se necessário
    formattedMessage = formattedMessage.replace('{date}', new Date().toLocaleDateString());
    formattedMessage = formattedMessage.replace('{time}', new Date().toLocaleTimeString());

    return encodeURIComponent(formattedMessage);
}

// Rota principal de redirecionamento
router.get('/:customPath', async (req, res) => {
    try {
        const link = await HocketLink.findOne({ customPath: req.params.customPath });

        if (!link || !link.isActive) {
            return res.status(404).render('redirect/redirect-error', {
                message: 'Link não encontrado ou inativo',
                layout: false
            });
        }

        // Selecionar o número para redirecionamento
        const selectedNumber = await selectNumber(link);
        if (!selectedNumber) {
            return res.status(404).render('redirect/redirect-error', {
                message: 'Nenhum número disponível no momento',
                layout: false
            });
        }

        // Registrar o redirecionamento
        const redirectInfo = await logRedirect(link, selectedNumber, req);

        // Preparar a URL do WhatsApp
        let whatsappUrl = `https://wa.me/${selectedNumber}`;
        
        // Adicionar mensagem personalizada se existir
        if (link.customMessage) {
            const formattedMessage = formatWhatsAppMessage(link.customMessage, {
                visitor_ip: req.ip,
                browser: req.useragent.browser,
                os: req.useragent.os,
                device: req.useragent.isMobile ? 'mobile' : 'desktop'
            });
            whatsappUrl += `?text=${formattedMessage}`;
        }

        // Se houver meta tags, renderizar página intermediária
        if (link.metaTags && Object.keys(link.metaTags).some(key => link.metaTags[key])) {
            return res.render('redirect/redirect-page', {
                layout: false,
                link: link,
                redirectUrl: whatsappUrl,
                messageDelay: link.messageDelay || 0,
                meta: {
                    title: link.metaTags.title || 'Redirecionando...',
                    description: link.metaTags.description || '',
                    image: link.metaTags.image || '',
                    url: `${req.protocol}://${req.get('host')}${req.originalUrl}`
                }
            });
        }

        // Se houver delay configurado
        if (link.messageDelay && link.messageDelay > 0) {
            res.render('redirect/redirect-delay', {
                layout: false,
                redirectUrl: whatsappUrl,
                delay: link.messageDelay
            });
        } else {
            // Redirecionamento direto
            res.redirect(whatsappUrl);
        }

    } catch (error) {
        console.error('Error in redirect:', error);
        res.status(500).render('redirect/redirect-error', {
            message: 'Erro ao processar redirecionamento',
            layout: false
        });
    }
});

// Rota para preview do redirecionamento (uso administrativo)
router.get('/preview/:customPath', async (req, res) => {
    try {
        const link = await HocketLink.findOne({ customPath: req.params.customPath });
        
        if (!link) {
            return res.status(404).json({ error: 'Link não encontrado' });
        }

        const selectedNumber = await selectNumber(link);
        const previewUrl = `https://wa.me/${selectedNumber}`;
        
        let previewMessage = '';
        if (link.customMessage) {
            previewMessage = formatWhatsAppMessage(link.customMessage, {
                visitor_ip: 'PREVIEW_IP',
                browser: 'PREVIEW_BROWSER',
                os: 'PREVIEW_OS',
                device: 'PREVIEW_DEVICE'
            });
        }

        res.json({
            whatsappUrl: previewUrl,
            message: decodeURIComponent(previewMessage),
            number: selectedNumber,
            metaTags: link.metaTags,
            delay: link.messageDelay
        });

    } catch (error) {
        console.error('Error in preview:', error);
        res.status(500).json({ error: 'Erro ao gerar preview' });
    }
});

module.exports = router;