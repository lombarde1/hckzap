const mongoose = require('mongoose');

const cartpandaEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    enum: ['abandoned_cart', 'pix_generated', 'payment_confirmed', 'order_created'],
    required: true
  },
  isActive: {
    type: Boolean,
    default: false
  },
  funnelId: {
    type: String
  },
  delay: {
    type: Number,
    default: 0
  }
});

const cartpandaConfigSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  webhookUrl: {
    type: String,
    required: true
  },
  webhookToken: {
    type: String,
    required: true
  },
  instanceKey: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: false
  },
  events: [cartpandaEventSchema],
  lastWebhookReceived: {
    type: Date
  }
}, { 
  timestamps: true,
  toJSON: { 
    transform: function(doc, ret) {
      // Garante que a URL do webhook está formatada corretamente
      if (ret.webhookUrl) {
        ret.webhookUrl = ret.webhookUrl.replace(/([^:]\/)\/+/g, "$1"); // Remove barras duplicadas
      }
      return ret;
    }
  }
});

// Remove índices únicos para evitar problemas
cartpandaConfigSchema.index({ user: 1 });
cartpandaConfigSchema.index({ webhookToken: 1 });

module.exports = mongoose.model('CartpandaConfig', cartpandaConfigSchema);