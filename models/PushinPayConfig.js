// models/PushinPayConfig.js
const mongoose = require('mongoose');

const PushinPayConfigSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  apiToken: { type: String, required: true },
  webhookUrl: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  lastWebhookReceived: { type: Date },
  paymentMappings: {
    type: Map,
    of: {
      paymentId: String,
      status: String,
      amount: Number,
      chatId: String,
      instanceKey: String,
      funnelId: String,
      nodeId: String
    }
  }
});

module.exports = mongoose.model('PushinPayConfig', PushinPayConfigSchema);