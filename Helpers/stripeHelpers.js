// helpers/stripeHelpers.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const { avisar } = require("./avisos");

const PRICE_TO_PLAN = {
    'price_1Pv8IfJd0dkXl3iIPFkZLOPJ': 'basico_monthly',

    'price_1Pzr6UJd0dkXl3iIcRukFSiX': 'plus_monthly',
    'price_1Pzr78Jd0dkXl3iIlDGW1Wvf': 'premium_monthly',

    'price_1QCSL1Jd0dkXl3iIzo7idTLr': 'basico_quarterly',
    'price_1QCSMcJd0dkXl3iIT2fNgEje': 'basico_semiannual',

    'price_1QCSLXJd0dkXl3iIgTIRp6EP': 'plus_quarterly',
    'price_1QCSN6Jd0dkXl3iIOu3IAF3o': 'plus_semiannual',

    'price_1QCSLxJd0dkXl3iIK95bNBJC': 'premium_quarterly',
    'price_1QCSNaJd0dkXl3iIEmCj7fcB': 'premium_semiannual'
};

const PLAN_TO_PRICE = {
    'basico_monthly': 'price_1Pv8IfJd0dkXl3iIPFkZLOPJ',
    'plus_monthly': 'price_1Pzr6UJd0dkXl3iIcRukFSiX',
    'premium_monthly': 'price_1Pzr78Jd0dkXl3iIlDGW1Wvf',
    'basico_quarterly': 'price_1QCSL1Jd0dkXl3iIzo7idTLr',
    'basico_semiannual': 'price_1QCSMcJd0dkXl3iIT2fNgEje',
    'plus_quarterly': 'price_1QCSLXJd0dkXl3iIgTIRp6EP',
    'plus_semiannual': 'price_1QCSN6Jd0dkXl3iIOu3IAF3o',
    'premium_quarterly': 'price_1QCSLxJd0dkXl3iIK95bNBJC',
    'premium_semiannual': 'price_1QCSNaJd0dkXl3iIEmCj7fcB'
};

exports.getPlanFromPriceId = (priceId) => {
    return PRICE_TO_PLAN[priceId] || 'gratuito';
};

exports.getPriceIdFromPlan = (plan) => {
    return PLAN_TO_PRICE[plan];
};

exports.createCheckoutSession = async (userId, plan, successUrl, cancelUrl) => {
    console.log(plan);
    const priceId = await this.getPriceIdFromPlan(plan);
    console.log(priceId);
    if (!priceId) {
        throw new Error('Plano inválido');
    }

    return await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
    });
};

exports.retrieveSubscription = async (subscriptionId) => {
    return await stripe.subscriptions.retrieve(subscriptionId);
};

exports.handleSuccessfulPayment = async (session) => {
    const userId = session.client_reference_id;
    const user = await User.findById(userId);
  
    if (!user) {
      throw new Error('Usuário não encontrado');
    }
  
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const planName = this.getPlanFromPriceId(subscription.items.data[0].price.id);
    const planBase = planName.split('_')[0];
  
    let validUntil;
    if (planName.includes('monthly')) {
        validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias
    } else if (planName.includes('quarterly')) {
        validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 dias
    } else if (planName.includes('semiannual')) {
        validUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000); // 180 dias
    }

    await User.findByIdAndUpdate(userId, {
      plan: planName,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      validUntil: validUntil,
      // Use o planBase para definir limites
      funnelLimit: PLAN_LIMITS[planBase].funnels,
      $push: {
        notifications: {
          title: `Plano ${planName} ativado`,
          content: 'Sua assinatura foi ativada com sucesso!',
          timestamp: new Date()
        }
      }
    });
  
    await avisar(user.phone, `Parabéns, ${user.name}! Seu plano ${planName} foi ativado com sucesso. Aproveite todos os recursos!`);
};

// Adicione outras funções relacionadas ao Stripe conforme necessário