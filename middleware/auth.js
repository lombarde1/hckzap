const User = require("../models/User");
const DailyUsage = require('../models/DailyUsage');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { avisar } = require("../Helpers/avisos")

module.exports = {
  ensureAuthenticated: async (req, res, next) => {
    if (req.isAuthenticated()) {
      const user = req.user;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      let dailyUsage = await DailyUsage.findOne({ userId: user._id, date: today });
      if (!dailyUsage) {
        dailyUsage = new DailyUsage({ userId: user._id, date: today });
        await dailyUsage.save();
      }

      if (user.manualPlanActive && user.validUntil) {
        if (user.validUntil > now) {
          return next();
        } else {
          await updateToFreePlan(user);
          try {
            await avisar(req.user.phone, `Ei ${req.user.name}, seu plano manual expirou. Que tal renovar?`, "darkadm");
          } catch(e) {
            console.log("Erro ao avisar numero")
          }
          
          return next();
        }
      }
      
      if (user.stripeSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

          if (subscription.status === 'active') {
            if (subscription.current_period_end * 1000 < now.getTime()) {
              await updateSubscriptionStatus(user, subscription);
            }
          } else {
            await updateToFreePlan(user);
            await avisar(req.user.phone, `Ei ${req.user.name}, sua assinatura do Stripe expirou. Que tal renovar?`,  "darkadm");
          }
        } catch (error) {
          console.error('Error checking subscription status:', error);
          await updateToFreePlan(user);
        }
      } else if (user.validUntil && user.validUntil < now) {
        await updateToFreePlan(user);
      }

      return next();
    }
    res.redirect('https://hocketzap.com');
  },
  ensureAdmin: (req, res, next) => {
    if (req.isAuthenticated() && req.user.role === 'admin' && req.session.isAdmin) {
      return next();
    }
    res.redirect('/admin/login');
  }
};

async function updateToFreePlan(user) {
  const newFunnelLimit = 0;
  const newAutoResponseLimit = 0;
  const newFunnelUsage = Math.min(user.funnelUsage, newFunnelLimit);
  const newAutoResponseCount = Math.min(user.autoResponseCount || 0, newAutoResponseLimit);

  await User.findByIdAndUpdate(user._id, {
    plan: 'gratuito',
    validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    funnelLimit: newFunnelLimit,
    funnelUsage: newFunnelUsage,
    autoResponseLimit: newAutoResponseLimit,
    autoResponseCount: newAutoResponseCount,
    $push: {
      notifications: {
        title: 'Plano Expirado',
        content: 'Seu plano expirou e foi atualizado para o plano gratuito.',
        timestamp: new Date()
      }
    }
  });

  // Update the user in the session
  user.plan = 'gratuito';
  user.validUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  user.funnelLimit = newFunnelLimit;
  user.funnelUsage = newFunnelUsage;
  user.autoResponseLimit = newAutoResponseLimit;
  user.autoResponseCount = newAutoResponseCount;
  user.notifications.push({
    title: 'Plano Expirado',
    content: 'Seu plano expirou e foi atualizado para o plano gratuito.',
    timestamp: new Date()
  });
}


async function updateSubscriptionStatus(user, subscription) {
  const planName = getPlanNameFromStripePrice(subscription.items.data[0].price.id);
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  // Calcular a nova data de validade com base no período de assinatura
  const subscriptionInterval = subscription.items.data[0].price.recurring.interval;
  const subscriptionIntervalCount = subscription.items.data[0].price.recurring.interval_count;
  let newValidUntil;

  if (subscriptionInterval === 'day') {
    newValidUntil = new Date(currentPeriodEnd.getTime() + subscriptionIntervalCount * 24 * 60 * 60 * 1000);
  } else if (subscriptionInterval === 'week') {
    newValidUntil = new Date(currentPeriodEnd.getTime() + subscriptionIntervalCount * 7 * 24 * 60 * 60 * 1000);
  } else if (subscriptionInterval === 'month') {
    newValidUntil = new Date(currentPeriodEnd.getFullYear(), currentPeriodEnd.getMonth() + subscriptionIntervalCount, currentPeriodEnd.getDate());
  } else if (subscriptionInterval === 'year') {
    newValidUntil = new Date(currentPeriodEnd.getFullYear() + subscriptionIntervalCount, currentPeriodEnd.getMonth(), currentPeriodEnd.getDate());
  }

  await User.findByIdAndUpdate(user._id, {
    plan: planName,
    validUntil: newValidUntil,
    $push: {
      notifications: {
        title: 'Assinatura Renovada',
        content: 'Sua assinatura foi renovada automaticamente.',
        timestamp: new Date()
      }
    }
  });

  // Atualizar o usuário na sessão
  user.plan = planName;
  user.validUntil = newValidUntil;
  user.notifications.push({
    title: 'Assinatura Renovada',
    content: 'Sua assinatura foi renovada automaticamente.',
    timestamp: new Date()
  });
}

function getPlanNameFromStripePrice(priceId) {
  // Mapeie os IDs de preço do Stripe para os nomes dos planos
  const priceToPlans = {
    'price_1Pv8IfJd0dkXl3iIPFkZLOPJ': 'basico',
    'price_1Pzr6UJd0dkXl3iIcRukFSiX': 'plus',
    'price_1Pzr78Jd0dkXl3iIlDGW1Wvf': 'premium'
  };
  return priceToPlans[priceId] || 'gratuito';
}

