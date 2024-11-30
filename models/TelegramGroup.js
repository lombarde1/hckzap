// models/TelegramGroup.js
const mongoose = require('mongoose');

const telegramGroupSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  telegramId: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  settings: {
    autoDeleteMessages: {
      enabled: {
        type: Boolean,
        default: false
      },
      deleteAfter: {
        type: Number,
        default: 24,
        min: 1,
        max: 168 // 1 semana em horas
      }
    },
    welcomeMessage: {
      enabled: {
        type: Boolean,
        default: false
      },
      message: {
        type: String,
        maxLength: 4096
      },
      mediaUrl: String,
      mediaType: {
        type: String,
        enum: ['none', 'photo', 'video'],
        default: 'none'
      }
    },
    antiSpam: {
      enabled: {
        type: Boolean,
        default: false
      },
      maxMessages: {
        type: Number,
        default: 5,
        min: 1,
        max: 100
      },
      timeWindow: {
        type: Number,
        default: 60,
        min: 10,
        max: 3600
      },
      action: {
        type: String,
        enum: ['warn', 'mute', 'kick', 'ban'],
        default: 'warn'
      }
    },
    restrictedWords: {
      enabled: {
        type: Boolean,
        default: false
      },
      words: [String],
      action: {
        type: String,
        enum: ['delete', 'warn', 'mute'],
        default: 'delete'
      }
    }
  },
  stats: {
    memberCount: {
      type: Number,
      default: 0,
      min: 0
    },
    activeUsers: {
      type: Number,
      default: 0,
      min: 0
    },
    messageCount: {
      type: Number,
      default: 0,
      min: 0
    },
    dailyStats: [{
      date: {
        type: Date,
        required: true
      },
      messages: {
        type: Number,
        default: 0,
        min: 0
      },
      newMembers: {
        type: Number,
        default: 0,
        min: 0
      },
      leftMembers: {
        type: Number,
        default: 0,
        min: 0
      },
      interactions: {
        type: Number,
        default: 0,
        min: 0
      }
    }],
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastChecked: {
    type: Date,
    default: Date.now
  },
  permissions: {
    canPostMessages: {
      type: Boolean,
      default: true
    },
    canEditMessages: {
      type: Boolean,
      default: false
    },
    canDeleteMessages: {
      type: Boolean,
      default: false
    },
    canManageMembers: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Índices
telegramGroupSchema.index({ userId: 1, telegramId: 1 });
telegramGroupSchema.index({ 'stats.lastUpdated': 1 });
telegramGroupSchema.index({ isActive: 1, lastChecked: 1 });

// Virtuals
telegramGroupSchema.virtual('status').get(function() {
  const now = new Date();
  const hoursSinceLastCheck = Math.abs(now - this.lastChecked) / 36e5;
  
  if (!this.isActive) return 'inactive';
  if (hoursSinceLastCheck > 24) return 'unavailable';
  return 'active';
});

// Métodos
telegramGroupSchema.methods = {
  // Atualizar estatísticas
  async updateStats(newStats) {
    this.stats = {
      ...this.stats,
      ...newStats,
      lastUpdated: new Date()
    };
    return this.save();
  },

  // Adicionar estatísticas diárias
  async addDailyStats(stats) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingStatIndex = this.stats.dailyStats.findIndex(
      stat => stat.date.toDateString() === today.toDateString()
    );

    if (existingStatIndex > -1) {
      this.stats.dailyStats[existingStatIndex] = {
        ...this.stats.dailyStats[existingStatIndex],
        ...stats
      };
    } else {
      this.stats.dailyStats.push({
        date: today,
        ...stats
      });
    }

    // Manter apenas os últimos 30 dias
    if (this.stats.dailyStats.length > 30) {
      this.stats.dailyStats = this.stats.dailyStats.slice(-30);
    }

    return this.save();
  },

  // Atualizar configurações
  async updateSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings
    };
    return this.save();
  },

  // Verificar e atualizar permissões
  async updatePermissions(newPermissions) {
    this.permissions = {
      ...this.permissions,
      ...newPermissions
    };
    return this.save();
  }
};

// Statics
telegramGroupSchema.statics = {
  // Buscar grupos ativos
  async findActive() {
    return this.find({ isActive: true });
  },

  // Buscar grupos que precisam de atualização
  async findNeedingUpdate(hoursThreshold = 24) {
    const threshold = new Date();
    threshold.setHours(threshold.getHours() - hoursThreshold);

    return this.find({
      isActive: true,
      lastChecked: { $lt: threshold }
    });
  },

  // Obter estatísticas agregadas
  async getAggregateStats(userId) {
    return this.aggregate([
      { $match: { userId, isActive: true } },
      {
        $group: {
          _id: null,
          totalGroups: { $sum: 1 },
          totalMembers: { $sum: '$stats.memberCount' },
          avgActiveUsers: { $avg: '$stats.activeUsers' },
          totalMessages: { $sum: '$stats.messageCount' }
        }
      }
    ]);
  }
};

module.exports = mongoose.model('TelegramGroup', telegramGroupSchema);