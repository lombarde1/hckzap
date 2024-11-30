// helpers/stripeHelpers.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const { avisar } = require("./avisos");

const PRICE_TO_PLAN = {
    'price_1QQiNHLnnNeQfOms7RN4o0JY': 'basico_monthly',

    'price_1QQiNILnnNeQfOmsYaLmyZ76': 'plus_monthly',
    'price_1QQiNJLnnNeQfOms1VLXP0mi': 'premium_monthly',

    'price_1QQiNILnnNeQfOms5TBJOC8F': 'basico_quarterly',
    'price_1QQiNILnnNeQfOmsJH8PtasA': 'basico_semiannual',

    'price_1QQiNJLnnNeQfOmsekG2AoGZ': 'plus_quarterly',
    'price_1QQiNJLnnNeQfOmsl3UzvkmP': 'plus_semiannual',

    'price_1QQiNKLnnNeQfOmsZxChFy5C': 'premium_quarterly',
    'price_1QQiNKLnnNeQfOmsb2YuzSf0': 'premium_semiannual'
};

const PLAN_TO_PRICE = {
    'basico_monthly': 'price_1QQiNHLnnNeQfOms7RN4o0JY',
    'plus_monthly': 'price_1QQiNILnnNeQfOmsYaLmyZ76',
    'premium_monthly': 'price_1QQiNJLnnNeQfOms1VLXP0mi',
    'basico_quarterly': 'price_1QQiNILnnNeQfOms5TBJOC8F',
    'basico_semiannual': 'price_1QQiNILnnNeQfOmsJH8PtasA',
    'plus_quarterly': 'price_1QQiNJLnnNeQfOmsekG2AoGZ',
    'plus_semiannual': 'price_1QQiNJLnnNeQfOmsl3UzvkmP',
    'premium_quarterly': 'price_1QQiNKLnnNeQfOmsZxChFy5C',
    'premium_semiannual': 'price_1QQiNKLnnNeQfOmsb2YuzSf0'
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
  
    await avisar(user.phone, `Parabéns, ${user.name}! Seu plano ${planName} foi ativado com sucesso. Aproveite todos os recursos!`, "darkadm");
};

// Adicione outras funções relacionadas ao Stripe conforme necessário