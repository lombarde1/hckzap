// helpers/stripeHelpers.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const { avisar } = require("./avisos");

const PRICE_TO_PLAN = {
    'price_1PkbaxJd0dkXl3iIiP1BL4gM': 'basico_monthly',

    'price_1QCRLZJd0dkXl3iIIO9qLQXG': 'plus_monthly',
    'price_1QCRLqJd0dkXl3iIkt5uvfM4': 'premium_monthly',

    'price_1QCRMAJd0dkXl3iINF5Wy17b': 'basico_quarterly',
    'price_1QCRNIJd0dkXl3iIt27bV3rJ': 'basico_semiannual',

    'price_1QCRMdJd0dkXl3iI7z8yXLm6': 'plus_quarterly',
    'price_1QCRNbJd0dkXl3iIp50Hpje4': 'plus_semiannual',

    'price_1QCRMzJd0dkXl3iIRzTv1Dh2': 'premium_quarterly',
    'price_1QCRNuJd0dkXl3iImC88is9t': 'premium_semiannual'
};

const PLAN_TO_PRICE = {
    'basico_monthly': 'price_1PkbaxJd0dkXl3iIiP1BL4gM',
    'plus_monthly': 'price_1QCRLZJd0dkXl3iIIO9qLQXG',
    'premium_monthly': 'price_1QCRLqJd0dkXl3iIkt5uvfM4',
    'basico_quarterly': 'price_1QCRMAJd0dkXl3iINF5Wy17b',
    'basico_semiannual': 'price_1QCRNIJd0dkXl3iIt27bV3rJ',
    'plus_quarterly': 'price_1QCRMdJd0dkXl3iI7z8yXLm6',
    'plus_semiannual': 'price_1QCRNbJd0dkXl3iIp50Hpje4',
    'premium_quarterly': 'price_1QCRMzJd0dkXl3iIRzTv1Dh2',
    'premium_semiannual': 'price_1QCRNuJd0dkXl3iImC88is9t'
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