 const mongoose = require('mongoose');

const hocketLinkSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  customPath: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9-]+$/, 'Custom path can only contain lowercase letters, numbers, and hyphens']
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  numbers: [{
    whatsappNumber: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{10,15}$/.test(v.replace(/\D/g, ''));
        },
        message: props => `${props.value} is not a valid WhatsApp number!`
      }
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastUsed: Date
  }],
  redirectType: {
    type: String,
    enum: ['random', 'rotative'],
    default: 'random'
  },
  customMessage: {
    type: String,
    maxLength: 1000
  },
  messageDelay: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  metaTags: {
    title: String,
    description: String,
    image: String
  },
  stats: {
    clicks: {
      type: Number,
      default: 0
    },
    lastClick: Date,
    redirectHistory: [{
      timestamp: Date,
      number: String,
      userAgent: String,
      ip: String
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUsedIndex: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Índices para melhor performance
hocketLinkSchema.index({ customPath: 1 });
hocketLinkSchema.index({ user: 1 });
hocketLinkSchema.index({ 'stats.lastClick': -1 });

// Middleware para atualizar o updatedAt
hocketLinkSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('HocketLink', hocketLinkSchema);