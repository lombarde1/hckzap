const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { ensureAdmin } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const ValidationKey = require('../models/ValidationKey');
const { Parser } = require('json2csv');
const PLAN_LIMITS = require('../config/planLimits');
const { avisar } = require("../Helpers/avisos");
const {addUserToGroup} = require("../Helpers/addgp")
// Adicione estas rotas ao seu arquivo de rotas admin (provavelmente admin.js)

// Rota para obter usuários com planos próximos do vencimento
router.get('/expiring-plans', ensureAdmin, async (req, res) => {
    try {
        const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const users = await User.find({
            $or: [
                { manualPlanActive: true, validUntil: { $lte: thirtyDaysFromNow, $gte: new Date() } },
                { stripeSubscriptionIde: { $exists: true, $ne: null }, validUntil: { $lte: thirtyDaysFromNow, $gte: new Date() } }
            ]
        }).sort({ validUntil: 1 });

        const expiringPlans = users.map(user => ({
            id: user._id,
            name: user.name,
            plan: user.plan,
            validUntil: user.validUntil,
            daysRemaining: Math.ceil((user.validUntil - new Date()) / (1000 * 60 * 60 * 24)),
            phone: user.phone
        }));

        res.json(expiringPlans);
    } catch (error) {
        console.error('Erro ao obter planos próximos do vencimento:', error);
        res.status(500).json({ error: 'Erro ao obter planos próximos do vencimento' });
    }
});

// Rota para enviar lembrete
router.post('/send-reminder', ensureAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        const message = `Olá ${user.name}! 👋

Esperamos que esteja aproveitando ao máximo seu plano ${user.plan} do HocketZap. 🚀

Gostaríamos de lembrá-lo que seu plano atual expirará em ${user.daysRemaining} dias. Para continuar aproveitando todos os benefícios e recursos exclusivos, não se esqueça de renovar sua assinatura.

Ao renovar agora, você garante:
✅ Continuidade dos seus projetos
✅ Acesso ininterrupto às nossas ferramentas avançadas
✅ Suporte prioritário da nossa equipe

Para renovar, é fácil! Basta acessar sua conta em https://dev.hocketzap.com e clicar em "Renovar Plano".

Tem alguma dúvida ou precisa de ajuda? Estamos aqui para você! Responda esta mensagem ou entre em contato pelo nosso suporte.

Obrigado por fazer parte da família HocketZap! 🎉

Atenciosamente,
Equipe HocketZap`;
console.log(user.phone, message)
        await avisar(user.phone, message, "darkadm");
        res.json({ success: true, message: 'Lembrete enviado com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar lembrete:', error);
        res.status(500).json({ error: 'Erro ao enviar lembrete' });
    }
});

router.get('/login', (req, res) => {
    res.render('admin-login', { user: req.user });
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username, role: 'admin' });
        if (user && await user.isValidPassword(password)) {
            req.session.isAdmin = true;
            res.redirect('/admin');
        } else {
            res.render('admin-login', { error: 'Credenciais inválidas' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).render('admin-login', { error: 'Erro no servidor' });
    }
});

router.get('/', ensureAdmin, async (req, res) => {
    try {
        const users = await User.find({});
        res.render('admin', { users, user: req.user });
    } catch (error) {
        res.status(500).send('Erro ao carregar usuários');
    }
});

router.post('/create-user', ensureAdmin, async (req, res) => {
    try {
        const { name, phone, email, username, password, role, plan, validUntil } = req.body;
        const user = new User({
            name,
            phone,
            email,
            username,
            password,
            role,
            plan,
            validUntil: new Date(validUntil)
        });
        await user.save();
        res.redirect('/admin');
    } catch (error) {
        res.status(500).send('Erro ao criar usuário');
    }
});

/*/
router.put('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const { name, email, phone, username, password, role, plan, validUntil } = req.body;
    console.log('Plano recebido:', plan);
    console.log('PLAN_LIMITS:', PLAN_LIMITS);

    if (!PLAN_LIMITS[plan]) {
      return res.status(400).json({ success: false, message: 'Plano inválido' });
    }

    const newFunnelLimit = PLAN_LIMITS[plan].funnels;
    let limitfunil = newFunnelLimit === Infinity ? 1000000 : newFunnelLimit;

    const updateData = {
      name,
      email,
      phone,
      username,
      role,
      plan,
      validUntil: new Date(validUntil),
      funnelLimit: limitfunil,
    };

    if (password) {
      updateData.password = password;
    }

    const oldUser = await User.findById(req.params.id);
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    // Adicionar notificação se o plano foi alterado
    if (oldUser.plan !== updatedUser.plan) {
      updatedUser.notifications.push({
        title: 'Alteração de Plano',
        content: `Seu plano foi alterado de ${oldUser.plan} para ${updatedUser.plan}.`,
        timestamp: new Date()
      });

      // Enviar mensagem via WhatsApp
      await avisar(updatedUser.phone, `Olá ${updatedUser.name}, seu plano no HocketZap foi alterado de ${oldUser.plan} para ${updatedUser.plan}. Aproveite os novos recursos!`, 'darkadm');
      await addUserToGroup(updatedUser.phone);

   
    }

    await updatedUser.save();

    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar usuário', error: error.message });
  }
});
/*/

router.put('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const { 
      name, email, phone, username, password, role, 
      plan, validUntil, dailyLimit, funnelLimit, autoResponseLimit 
    } = req.body;

    // Validar plano
    if (!PLAN_LIMITS[plan]) {
      return res.status(400).json({ success: false, message: 'Plano inválido' });
    }

    // Preparar dados para atualização
    const updateData = {
      name,
      email,
      phone,
      username,
      role,
      plan,
      validUntil: new Date(validUntil),
      dailyLimit,
      funnelLimit,
      autoResponseLimit
    };

    // Só atualiza a senha se ela foi fornecida
    if (password && password.trim()) {
     
      updateData.password = password
    }

    // Buscar usuário antigo para comparações
    const oldUser = await User.findById(req.params.id);
    
    // Atualizar usuário
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    // Adicionar notificação se houve mudança de plano
    if (oldUser.plan !== updatedUser.plan) {
      updatedUser.notifications.push({
        title: 'Alteração de Plano',
        content: `Seu plano foi alterado de ${oldUser.plan} para ${updatedUser.plan}.`,
        timestamp: new Date()
      });

      // Enviar notificação via WhatsApp
      await avisar(
        updatedUser.phone, 
        `Olá ${updatedUser.name}, seu plano no HocketZap foi alterado de ${oldUser.plan} para ${updatedUser.plan}. Aproveite os novos recursos!`,
        'darkadm'
      );
    }

    await updatedUser.save();
    res.json({ success: true, user: updatedUser });
    
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao atualizar usuário', 
      error: error.message 
    });
  }
});

router.delete('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    res.json({ success: true, message: 'Usuário deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar usuário:', error);
    res.status(500).json({ success: false, message: 'Erro ao deletar usuário' });
  }
})

/*/
router.get('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    res.json(user);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário' });
  }
});/*/

router.get('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('+password'); // Include password field
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    res.json(user);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar usuário' });
  }
});

router.get('/create-validation-key', ensureAdmin, async (req, res) => {
    try {
        const { plan } = req.query;

        if (!plan) {
            return res.status(400).json({ success: false, message: 'O plano é obrigatório' });
        }

        if (!['basico', 'plus', 'premium'].includes(plan)) {
            return res.status(400).json({ success: false, message: 'Plano inválido. Deve ser "basico", "plus" ou "premium"' });
        }

        const key = await generateUniqueKey();
        const newValidationKey = new ValidationKey({
            key: key,
            plan: plan
        });

        await newValidationKey.save();

        res.json({ success: true, key, plan });
    } catch (error) {
        console.error('Erro ao criar chave de validação:', error);
        res.status(500).json({ success: false, message: 'Erro ao criar chave de validação' });
    }
});

router.get('/validation-keys', ensureAdmin, async (req, res) => {
    try {
        const keys = await ValidationKey.find().lean();
        res.json(keys);
    } catch (error) {
        console.error('Erro ao listar chaves de validação:', error);
        res.status(500).json({ message: 'Erro ao listar chaves de validação' });
    }
});

router.get('/export-users', ensureAdmin, async (req, res) => {
  try {
    const users = await User.find({}).lean();

    const fields = [
      { label: 'Nome', value: 'name' },
      { label: 'Email', value: 'email' },
      { label: 'Telefone', value: 'phone' },
      { label: 'Username', value: 'username' },
      { label: 'Cargo', value: 'role' },
      { label: 'Plano', value: 'plan' },
      { label: 'Plano Manual Ativo', value: 'manualPlanActive' },
      { label: 'Validade do Plano Manual', value: row => row.validUntil ? new Date(row.validUntil).toLocaleDateString() : 'N/A' },
      { label: 'Limite de Funis', value: 'funnelLimit' },
      { label: 'Limite de Auto Respostas', value: 'autoResponseLimit' }
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(users);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=usuarios_budzap.csv');
    res.status(200).send(csv);

  } catch (error) {
    console.error('Erro ao exportar usuários:', error);
    res.status(500).json({ success: false, message: 'Erro ao exportar usuários', error: error.message });
  }
});

function generateUniqueKey() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

router.get('/growth-stats', ensureAdmin, async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json(userGrowth);
  } catch (error) {
    console.error('Erro ao obter estatísticas de crescimento:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas de crescimento' });
  }
});

router.get('/plan-stats', ensureAdmin, async (req, res) => {
  try {
    const planStats = await User.aggregate([
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          manualCount: {
            $sum: {
              $cond: ['$manualPlanActive', 1, 0]
            }
          },
          stripeCount: {
            $sum: {
              $cond: [{ $ne: ['$stripeSubscriptionId', undefined] }, 1, 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          plan: '$_id',
          count: 1,
          manualCount: 1,
          stripeCount: 1
        }
      }
    ]);

    res.json(planStats);
  } catch (error) {
    console.error('Erro ao obter estatísticas de planos:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas de planos' });
  }
});

router.get('/dashboard-data', ensureAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const now = new Date();

    const activeUsers = await User.aggregate([
      {
        $match: {
          $or: [
            { manualPlanActive: true, validUntil: { $gt: now } },
            { stripeSubscriptionId: { $exists: true, $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 }
        }
      }
    ]);

    const planPrices = {
      gratuito: 0,
      basico_monthly: 65,
      basico_quarterly: 175,
      basico_semiannual: 330 ,
      plus_monthly: 110,
      plus_quarterly: 297 ,
      plus_semiannual: 561 ,
      premium_monthly: 180,
      premium_quarterly: 486 ,
      premium_semiannual: 918 
    };

    let monthlyRevenue = 0;
    const usersByPlanObject = {};

    activeUsers.forEach(plan => {
      usersByPlanObject[plan._id] = plan.count;
      monthlyRevenue += plan.count * (planPrices[plan._id] || 0);
    });

    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringUsers = await User.aggregate([
      {
        $match: {
          $or: [
            {
              validUntil: { $lte: thirtyDaysFromNow, $gte: now }
            },
            {
              validUntil: { $lte: thirtyDaysFromNow, $gte: now }
            }
          ]
        }
      },
      {
        $project: {
          name: 1,
          validUntil: 1,
          stripeSubscriptionId: 1,
          daysRemaining: {
            $ceil: {
              $divide: [{ $subtract: ['$validUntil', now] }, 1000 * 60 * 60 * 24]
            }
          },
          isStripeCustomer: {
            $cond: [{ $ne: ['$stripeSubscriptionId', undefined] }, true, false]
          }
        }
      },
      {
        $sort: { validUntil: 1 }
      }
    ]);

    console.log(expiringUsers)
    res.json({
      totalUsers,
      usersByPlan: usersByPlanObject,
      monthlyRevenue,
      expiringUsers
    });
  } catch (error) {
    console.error('Erro ao obter dados do dashboard:', error);
    res.status(500).json({ error: 'Erro ao obter dados do dashboard' });
  }
});


router.put('/update-daily-limits/:userId', ensureAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { spamMessageLimit, autoResponseLimit } = req.body;

    // Encontra o usuário e atualiza seus limites
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }

    // Atualiza os limites no registro do usuário
    const updateData = {};
    if (spamMessageLimit !== undefined) {
      updateData.spamMessageLimit = spamMessageLimit;
    }
    if (autoResponseLimit !== undefined) {
      updateData.autoResponseLimit = autoResponseLimit;
    }

    // Encontra ou cria o registro de uso diário
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await DailyUsage.findOneAndUpdate(
      { userId, date: today },
      { $set: updateData },
      { upsert: true, new: true }
    );

    // Adiciona notificação para o usuário
    user.notifications.push({
      title: 'Limites Atualizados',
      content: 'Seus limites diários foram atualizados pelo administrador.',
      timestamp: new Date()
    });

    await user.save();

    res.json({
      success: true,
      message: 'Limites atualizados com sucesso',
      newLimits: updateData
    });
  } catch (error) {
    console.error('Erro ao atualizar limites:', error);
    res.status(500).json({ success: false, message: 'Erro ao atualizar limites', error: error.message });
  }
});

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const DailyUsage = require('../models/DailyUsage');

// Rota para obter todas as assinaturas do Stripe
router.get('/subscriptions', ensureAdmin, async (req, res) => {
  try {
    // Busca todas as assinaturas do Stripe
    const subscriptions = await stripe.subscriptions.list({
      limit: 100,
      expand: ['data.customer']
    });

    // Organiza os dados das assinaturas
    const formattedSubscriptions = await Promise.all(subscriptions.data.map(async (sub) => {
      const user = await User.findOne({ stripeCustomerId: sub.customer.id });
      
      return {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: new Date(sub.current_period_end * 1000),
        currentPeriodStart: new Date(sub.current_period_start * 1000),
        plan: {
          id: sub.items.data[0].price.id,
          name: sub.items.data[0].price.nickname,
          amount: sub.items.data[0].price.unit_amount / 100
        },
        customer: {
          id: sub.customer.id,
          email: sub.customer.email,
          name: sub.customer.name
        },
        user: user ? {
          id: user._id,
          username: user.username,
          email: user.email,
          phone: user.phone
        } : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null
      };
    }));

    // Calcula estatísticas
    const stats = {
      total: formattedSubscriptions.length,
      active: formattedSubscriptions.filter(sub => sub.status === 'active').length,
      canceled: formattedSubscriptions.filter(sub => sub.status === 'canceled').length,
      monthlyRecurringRevenue: formattedSubscriptions
        .filter(sub => sub.status === 'active')
        .reduce((sum, sub) => sum + sub.plan.amount, 0)
    };

    res.json({
      success: true,
      subscriptions: formattedSubscriptions,
      stats
    });
  } catch (error) {
    console.error('Erro ao buscar assinaturas:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar assinaturas', error: error.message });
  }
});

// Rota para obter todas as instâncias WhatsApp de todos os usuários
router.get('/whatsapp-instances', ensureAdmin, async (req, res) => {
  try {
    const users = await User.find().select('name email whatsappInstances');
    
    const allInstances = await Promise.all(users.map(async (user) => {
      const instances = await Promise.all(user.whatsappInstances.map(async (instance) => {
        try {
          // Verifica o status da instância na API
          const statusResponse = await axios.get(
            `https://api.hocketzap.com/instance/connectionState/${instance.name}`,
            { headers: { 'apikey': 'darkadm' } }
          );

          return {
            instanceId: instance._id,
            name: instance.name,
            key: instance.key,
            userId: user._id,
            userName: user.name,
            userEmail: user.email,
            createdAt: instance.createdAt,
            status: statusResponse.data.state,
            lastConnection: statusResponse.data.lastConnection,
            webhookUrl: instance.webhookUrl
          };
        } catch (error) {
          return {
            instanceId: instance._id,
            name: instance.name,
            key: instance.key,
            userId: user._id,
            userName: user.name,
            userEmail: user.email,
            createdAt: instance.createdAt,
            status: 'error',
            error: error.message
          };
        }
      }));

      return instances;
    }));

    // Flatten the array and add statistics
    const flattenedInstances = allInstances.flat();
    const stats = {
      total: flattenedInstances.length,
      connected: flattenedInstances.filter(inst => inst.status === 'connected').length,
      disconnected: flattenedInstances.filter(inst => inst.status === 'disconnected').length,
      error: flattenedInstances.filter(inst => inst.status === 'error').length,
      byUser: users.map(user => ({
        userId: user._id,
        userName: user.name,
        instanceCount: flattenedInstances.filter(inst => inst.userId.toString() === user._id.toString()).length
      }))
    };

    res.json({
      success: true,
      instances: flattenedInstances,
      stats
    });
  } catch (error) {
    console.error('Erro ao buscar instâncias:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar instâncias', error: error.message });
  }
});

// Rota para obter métricas gerais do sistema
router.get('/system-metrics', ensureAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Métricas de usuários
    const totalUsers = await User.countDocuments();
    const newUsers = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const activeUsers = await User.countDocuments({ 
      $or: [
        { 'whatsappInstances.isConnected': true },
        { lastApiRequest: { $gte: thirtyDaysAgo } }
      ]
    });

    // Métricas de uso
    const dailyUsage = await DailyUsage.aggregate([
      { $match: { date: { $gte: thirtyDaysAgo } } },
      { 
        $group: {
          _id: null,
          totalAutoResponses: { $sum: '$autoResponses' },
          totalSpamMessages: { $sum: '$spamMessages' }
        }
      }
    ]);

    // Métricas de instâncias WhatsApp
    const whatsappMetrics = await User.aggregate([
      { $unwind: '$whatsappInstances' },
      { 
        $group: {
          _id: null,
          totalInstances: { $sum: 1 },
          activeInstances: { 
            $sum: { $cond: [{ $eq: ['$whatsappInstances.isConnected', true] }, 1, 0] }
          }
        }
      }
    ]);

    // Métricas de assinaturas
    const subscriptionMetrics = await User.aggregate([
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      metrics: {
        users: {
          total: totalUsers,
          newLast30Days: newUsers,
          active: activeUsers
        },
        usage: dailyUsage[0] || { totalAutoResponses: 0, totalSpamMessages: 0 },
        whatsapp: whatsappMetrics[0] || { totalInstances: 0, activeInstances: 0 },
        subscriptions: subscriptionMetrics
      }
    });
  } catch (error) {
    console.error('Erro ao buscar métricas do sistema:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar métricas', error: error.message });
  }
});

// Rota para gerenciar notificações em massa
router.post('/mass-notification', ensureAdmin, async (req, res) => {
  try {
    const { title, content, targetPlan, sendWhatsapp } = req.body;

    // Construir query baseada nos filtros
    let query = {};
    if (targetPlan) {
      query.plan = targetPlan;
    }

    const users = await User.find(query);
    
    const results = {
      success: [],
      failed: [],
      total: users.length
    };

    // Processar usuários em série para melhor controle de erros
    for (const user of users) {
      try {
        // Adicionar notificação
        user.notifications.push({
          title,
          content,
          timestamp: new Date()
        });
        await user.save();

        // Enviar WhatsApp se solicitado
        if (sendWhatsapp) {
          try {
            await avisar(user.phone, `${title}\n\n${content}`);
            results.success.push({
              userId: user._id,
              phone: user.phone,
              notification: 'both' // Notificação interna e WhatsApp
            });
          } catch (whatsappError) {
            console.warn(`Erro ao enviar WhatsApp para ${user.phone}:`, whatsappError);
            results.success.push({
              userId: user._id,
              phone: user.phone,
              notification: 'internal-only' // Apenas notificação interna
            });
            results.failed.push({
              userId: user._id,
              phone: user.phone,
              error: 'whatsapp-failed',
              message: whatsappError.message
            });
          }
        } else {
          results.success.push({
            userId: user._id,
            phone: user.phone,
            notification: 'internal-only'
          });
        }

      } catch (userError) {
        console.warn(`Erro ao processar usuário ${user._id}:`, userError);
        results.failed.push({
          userId: user._id,
          phone: user.phone || 'N/A',
          error: 'validation-failed',
          message: userError.message
        });
        continue; // Continua para o próximo usuário
      }
    }

    // Preparar resposta com estatísticas
    const response = {
      success: true,
      message: 'Processo de notificação concluído',
      stats: {
        total: results.total,
        successful: results.success.length,
        failed: results.failed.length,
        successDetails: {
          bothNotifications: results.success.filter(r => r.notification === 'both').length,
          internalOnly: results.success.filter(r => r.notification === 'internal-only').length
        }
      },
      failed: results.failed
    };

    // Se houver falhas mas também sucessos, retorna 207 (Multi-Status)
    const statusCode = results.failed.length > 0 && results.success.length > 0 ? 207 :
                      results.failed.length === results.total ? 500 : 200;

    res.status(statusCode).json(response);

  } catch (error) {
    console.error('Erro geral ao enviar notificações:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erro ao processar notificações', 
      error: error.message 
    });
  }
});


router.get('/users', ensureAdmin, async (req, res) => {
  try {
      const users = await User.find({}).select('-password');
      res.json(users);
  } catch (error) {
      console.error('Erro ao obter usuários:', error);
      res.status(500).json({ error: 'Erro ao obter usuários' });
  }
});


module.exports = router;