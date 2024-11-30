// routes/whatsappInstances.js
const express = require('express');
const router = express.Router();
const whatsappInstanceController = require('../controllers/whatsappInstanceController');
const { ensureAuthenticated } = require('../middleware/auth');
const planCheck = require('../middleware/planCheck');
const User = require('../models/User');
const { getActiveFunnels } = require('../utils/funnelHelper');
const LimitsService = require('../services/limitsService');

// ... outras rotas ...

// Nova rota para obter limites
router.get('/limits', ensureAuthenticated, whatsappInstanceController.getInstanceLimits);

// Rota para renderizar a página de gerenciamento de instâncias do WhatsApp

// routes/whatsappInstances.js

const {updateCampaigns, getCampaigns, getAutoResponseReport, getAutoResponseUsage, toggleAutoResponse} = require('../controllers/autoResponseController');



const { checkAutoResponseLimit } = require('../middleware/autoResponseLimit');

router.post('/toggle-auto-response', ensureAuthenticated, checkAutoResponseLimit, toggleAutoResponse);
const massMessageController = require('../controllers/massMessageController');

router.get('/mass-message', ensureAuthenticated, massMessageController.renderMassMessagePage);
router.post('/start-mass-message', ensureAuthenticated, massMessageController.startMassMessage);
router.get('/mass-message-progress', ensureAuthenticated, massMessageController.getProgress);
router.post('/stop-mass-message', ensureAuthenticated, massMessageController.stopMassMessage);

router.get('/', ensureAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('plan whatsappInstances');
        res.render('whatsapp-instances', { 
            view: 'whatsapp-instances',  // Adicione esta linha
            title: 'Gerenciar Instâncias WhatsApp',  // E esta linha
            user: req.user,
            planLimits: { gratuito: 0, basico: 1, plus: 25, premium: 9999 }
        });
    } catch (error) {
        console.error('Erro ao carregar página de instâncias do WhatsApp:', error);
        res.status(500).render('error', { message: 'Erro ao carregar página de instâncias do WhatsApp' });
    }
});

router.get('/instance/:instanceKey', whatsappInstanceController.getInstanceDetails);
router.delete('/deleteAll', ensureAuthenticated, whatsappInstanceController.deleteAllInstances);
router.post('/create', ensureAuthenticated, whatsappInstanceController.createInstance);
router.get('/list', ensureAuthenticated, whatsappInstanceController.listInstances);
router.get('/listuser', whatsappInstanceController.listInstancesUser);
router.get('/checker/:instanceId', ensureAuthenticated, whatsappInstanceController.checkInstanceStatus);
router.get('/qr/:instanceId', ensureAuthenticated, whatsappInstanceController.getQRCode);
router.post('/disconnect/:instanceId', ensureAuthenticated, whatsappInstanceController.disconnectInstance);
router.delete('/delete/:instanceId', ensureAuthenticated, whatsappInstanceController.deleteInstance);

module.exports = router;
