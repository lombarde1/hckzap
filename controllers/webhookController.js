const Order = require('../models/Order');
const User = require('../models/User');
const { PLAN_LIMITS, AUTO_RESPONSE_LIMITS } = require('../config/planLimits');

const UserPurchasedFunnels = require('../models/UserPurchasedFunnels');
const CommunityFunnel = require('../models/CommunityFunnel');

exports.handlePagBankPixWebhook = async (req, res) => {
    try {
        const { reference_id, status } = req.body;

        if (status === 'PAID') {
            const funnelId = reference_id.split('_')[1];
            const funnel = await CommunityFunnel.findById(funnelId);

            if (funnel) {
                await UserPurchasedFunnels.create({
                    user: req.user._id,
                    funnel: funnelId
                });

                // Atualizar o usuário com o novo funil comprado
                await User.findByIdAndUpdate(req.user._id, {
                    $addToSet: { purchasedFunnels: funnelId }
                });
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Erro ao processar webhook do PagBank:', error);
        res.sendStatus(500);
    }
};

// Webhook handler no arquivo webhookController.js
exports.handlePushinPayWebhook = async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const { status, transaction_id } = req.body;

    console.log(`Webhook recebido para pagamento ${paymentId}:`, status);

    const config = await PushinPayConfig.findOne({
      'paymentMappings': { $exists: true },
      [`paymentMappings.${paymentId}`]: { $exists: true }
    });

    if (!config) {
      console.log('Pagamento não encontrado:', paymentId);
      return res.status(404).json({ error: 'Pagamento não encontrado' });
    }

    const paymentMapping = config.paymentMappings.get(paymentId);
    
    // Atualizar status do pagamento
    await config.updateOne({
      $set: { [`paymentMappings.${paymentId}.status`]: status }
    });

    // Se o pagamento foi aprovado
    if (status === 'paid') {
      // Remover o timeout pendente
      await redisClient.del(`payment_timeout_token:${paymentId}`);

      // Recuperar o estado atual do funil
      const autoResponseKey = `auto_response:${paymentMapping.instanceKey}:${paymentMapping.chatId}`;
      const stateData = await redisClient.get(autoResponseKey);
      
      if (stateData) {
        const state = JSON.parse(stateData);
        const funnel = await getFunnelById(paymentMapping.funnelId);
        
        // Encontrar conexão de sucesso (Right)
        const nextConnection = funnel.connections.find(conn => 
          conn.sourceId === paymentMapping.nodeId && conn.anchors[0] === 'Right'
        );

        if (nextConnection) {
          state.currentNodeId = nextConnection.targetId;
          await redisClient.setex(
            autoResponseKey,
            AUTO_RESPONSE_EXPIRY,
            JSON.stringify(state)
          );

          // Continuar a execução do funil
          executeFunnel(funnel, paymentMapping.chatId, paymentMapping.instanceKey, state);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
};

exports.handleWebhook = async (req, res) => {
  const { id, charges } = req.body;

  try {
    const order = await Order.findOne({ orderId: id });
    if (!order) {
      console.log(`Pedido não encontrado: ${id}`);
      return res.status(404).send('Pedido não encontrado');
    }

    const paymentStatus = charges[0].status;
    order.status = paymentStatus;
    await order.save();

    if (paymentStatus === 'PAID') {
      const user = await User.findById(order.userId);
      if (user) {
        user.plan = order.plan;
        user.validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        user.funnelLimit = PLAN_LIMITS[order.plan];
        user.autoResponseLimit = AUTO_RESPONSE_LIMITS[order.plan];
        await user.save();
        console.log(`Plano do usuário ${user._id} atualizado para ${order.plan}`);
      }
    }

    res.status(200).send('Webhook processado com sucesso');
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    res.status(500).send('Erro ao processar webhook');
  }
};
