const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/auth');
const {addUserToGroup} = require("../Helpers/addgp")
const stripeHelpers = require('../Helpers/stripeHelpers');

const DailyUsage = require('../models/DailyUsage');
const  PLAN_LIMITS = require('../config/planLimits');
const { avisar } = require("../Helpers/avisos");

router.get('/subscription-success', async (req, res) => {
    const { id, userId } = req.query;

    try {
        const session = await stripe.checkout.sessions.retrieve(id);
        console.log(session);
        console.log(session.payment_status);
        
        if (session.payment_status === 'paid') {
            const subscriptionId = session.subscription;

            // Recupera os detalhes da assinatura
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
            }

            const plano = await stripeHelpers.getPlanFromPriceId(subscription.items.data[0].price.id);
            console.log("Plano detectado:", plano);

            // Extrair o tipo de plano (basico, plus, premium)
            const planType = plano.split('_')[0];

            // Verifica se o plano existe no PLAN_LIMITS
            if (!PLAN_LIMITS[plano]) {
                console.error(`Plano não reconhecido: ${plano}`);
                return res.status(400).json({ success: false, message: 'Plano não reconhecido' });
            }

            // Se o pagamento foi aprovado, atualize o plano do usuário
            const newFunnelLimit = PLAN_LIMITS[plano].funnels;
            
            // Calcular validUntil baseado no tipo de plano
            let validUntil;
            let stringPlan;
            if (plano.includes('monthly')) {
                validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                stringPlan = "Mensal"
            } else if (plano.includes('quarterly')) {
                validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
                stringPlan = "Trimestral"
            } else if (plano.includes('semiannual')) {
                validUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
                stringPlan = "Semestral"
            }

            const updatedUser = await User.findByIdAndUpdate(
                userId,
                {
                    $set: {
                        stripeCustomerId: session.customer,
                        stripeSubscriptionId: subscriptionId,
                        plan: plano,
                        validUntil: validUntil,
                        funnelLimit: newFunnelLimit
                    },
                    $push: {
                        notifications: {
                            title: `Plano ${planType} ${stringPlan} assinado ✅`,
                            content: 'Bora aumentar suas vendas!',
                            timestamp: new Date()
                        }
                    }
                },
                { new: true, runValidators: true }
            );
            
            try {
                await avisar(user.phone, `🎉 Parabéns! Seu plano foi ativado com sucesso! 🚀

                    Agora você tem acesso a todos os recursos do plano  ${planType} ${stringPlan}. Aproveite!
                    
                    Se precisar de ajuda chame no número oficial de suporte: 17991134416`, "darkadm");
                    await addUserToGroup(user.phone);

            } catch (e) {
                console.log(e)
            }

           
            function formatarValorEmReais(valorEmCentavos) {
                const valorEmReais = valorEmCentavos / 100;
                return new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL'
                }).format(valorEmReais);
            }

            const valorFormatado = formatarValorEmReais(subscription.items.data[0].price.unit_amount);

           
            await avisar(process.env.numerodono, `🎉 *Nova venda realizada!*

💰 *Valor recebido:* ${valorFormatado}
📜 *Plano:*  ${planType} ${stringPlan}

👤 *Usuário:* ${user.username}
📞 *Número:* ${user.phone}

🎊 Parabéns pela venda!`, "darkadm");

            if (!updatedUser) {
                throw new Error('Falha ao atualizar o usuário');
            }

            // Renderiza a página de sucesso
            return res.render('plano-sucess', { 
                layout: false, 
                plan: plano,
                validUntil: validUntil.toLocaleDateString(),
                funnelLimit: newFunnelLimit
            });

        } else {
            // Se o pagamento não foi bem-sucedido, redireciona para o dashboard com status de erro
            return res.redirect('/dashboard?status=error');
        }
    } catch (error) {
        console.error('Error processing successful subscription:', error);
        return res.redirect('/dashboard?status=error');
    }
});

// ... rest of the file remains the same

module.exports = router;