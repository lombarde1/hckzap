// models/ScheduledPost.js
const mongoose = require('mongoose');

const scheduledPostSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TelegramGroup',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['text', 'photo', 'video', 'poll', 'audio', 'document'],
    required: true
  },
  content: {
    type: String,
    required: function() {
      return this.type === 'text';
    },
    maxLength: 4096 // Telegram message length limit
  },
  mediaUrl: {
    type: String,
    required: function() {
      return ['photo', 'video', 'audio', 'document'].includes(this.type);
    }
  },
  caption: {
    type: String,
    maxLength: 1024
  },
  scheduledTime: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: function(v) {
        return v > new Date();
      },
      message: 'Scheduled time must be in the future'
    }
  },
  recurringSchedule: {
    enabled: {
      type: Boolean,
      default: false
    },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'custom'],
      required: function() {
        return this.recurringSchedule?.enabled;
      }
    },
    daysOfWeek: [{
      type: Number,
      min: 0,
      max: 6
    }],
    timeOfDay: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: 'Time must be in HH:mm format'
      }
    },
    customInterval: {
      value: {
        type: Number,
        min: 1
      },
      unit: {
        type: String,
        enum: ['hours', 'days', 'weeks', 'months']
      }
    },
    endDate: {
      type: Date,
      validate: {
        validator: function(v) {
          return !v || v > this.scheduledTime;
        },
        message: 'End date must be after start date'
      }
    }
  },
  poll: {
    question: {
      type: String,
      required: function() {
        return this.type === 'poll';
      },
      maxLength: 300
    },
    options: {
      type: [String],
      validate: {
        validator: function(v) {
          return !this.type === 'poll' || (v && v.length >= 2 && v.length <= 10);
        },
        message: 'Polls must have between 2 and 10 options'
      }
    },
    multipleChoice: {
      type: Boolean,
      default: false
    },
    quizMode: {
      type: Boolean,
      default: false
    },
    correctOption: {
      type: Number,
      validate: {
        validator: function(v) {
          return !this.poll?.quizMode || (v >= 0 && v < this.poll.options.length);
        },
        message: 'Invalid correct option'
      }
    }
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  sendAttempts: {
    type: Number,
    default: 0,
    min: 0
  },
  lastAttempt: Date,
  sentAt: Date,
  messageId: String,
  error: String,
  analytics: {
    views: {
      type: Number,
      default: 0,
      min: 0
    },
    reactions: {
      type: Map,
      of: Number,
      default: () => new Map()
    },
    forwards: {
      type: Number,
      default: 0,
      min: 0
    },
    replies: {
      type: Number,
      default: 0,
      min: 0
    },
    pollVotes: {
      type: Number,
      default: 0,
      min: 0
    },
    engagement: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: () => new Map()
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Índices compostos para melhor performance
scheduledPostSchema.index({ userId: 1, status: 1 });
scheduledPostSchema.index({ scheduledTime: 1, status: 1 });
scheduledPostSchema.index({ groupId: 1, status: 1 });
scheduledPostSchema.index({ 'analytics.engagement': -1 });

// Virtual para status de agendamento
scheduledPostSchema.virtual('schedulingStatus').get(function() {
  if (this.status === 'sent') return 'completed';
  if (this.status === 'cancelled') return 'cancelled';
  if (this.status === 'failed') return 'failed';
  return this.scheduledTime > new Date() ? 'scheduled' : 'pending';
});

// Middleware de validação
scheduledPostSchema.pre('save', async function(next) {
  try {
    // Validar data de agendamento
    if (this.isNew && this.scheduledTime <= new Date()) {
      throw new Error('Scheduled time must be in the future');
    }

    // Validar configuração recorrente
    if (this.recurringSchedule?.enabled) {
      if (!this.recurringSchedule.frequency) {
        throw new Error('Frequency is required for recurring posts');
      }
      
      if (this.recurringSchedule.endDate && this.recurringSchedule.endDate <= this.scheduledTime) {
        throw new Error('End date must be after scheduled time');
      }

      if (this.recurringSchedule.frequency === 'weekly' && (!this.recurringSchedule.daysOfWeek || !this.recurringSchedule.daysOfWeek.length)) {
        throw new Error('Days of week are required for weekly recurring posts');
      }

      if (this.recurringSchedule.frequency === 'custom') {
        if (!this.recurringSchedule.customInterval?.value || !this.recurringSchedule.customInterval?.unit) {
          throw new Error('Custom interval configuration is required');
        }
      }
    }

    // Validar configuração de enquete
    if (this.type === 'poll') {
      if (!this.poll?.question) {
        throw new Error('Question is required for polls');
      }
      if (!this.poll?.options || this.poll.options.length < 2) {
        throw new Error('At least 2 options are required for polls');
      }
      if (this.poll.quizMode && typeof this.poll.correctOption !== 'number') {
        throw new Error('Correct option is required for quiz polls');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Métodos do modelo
scheduledPostSchema.methods = {
  // Atualizar analytics
  async updateAnalytics(newData) {
    const analytics = {
      ...this.analytics.toObject(),
      ...newData
    };
    
    // Recalcular engagement
    analytics.engagement = this.calculateEngagement(analytics);
    
    this.analytics = analytics;
    return this.save();
  },

  // Calcular engagement
  calculateEngagement(analytics) {
    const totalInteractions = 
      analytics.views + 
      analytics.forwards + 
      analytics.replies + 
      analytics.pollVotes + 
      Array.from(analytics.reactions.values()).reduce((a, b) => a + b, 0);
    
    return analytics.views > 0 ? 
      ((totalInteractions - analytics.views) / analytics.views) * 100 : 0;
  },

  // Cancelar post
  async cancel() {
    if (this.status !== 'pending') {
      throw new Error('Only pending posts can be cancelled');
    }
    this.status = 'cancelled';
    return this.save();
  },

  // Reagendar post
  async reschedule(newScheduledTime) {
    if (this.status !== 'pending') {
      throw new Error('Only pending posts can be rescheduled');
    }
    if (newScheduledTime <= new Date()) {
      throw new Error('New scheduled time must be in the future');
    }
    this.scheduledTime = newScheduledTime;
    return this.save();
  },

  // Duplicar post
  async duplicate(newScheduledTime) {
    const duplicatedPost = new ScheduledPost({
      ...this.toObject(),
      _id: undefined,
      scheduledTime: newScheduledTime || moment().add(1, 'day').toDate(),
      status: 'pending',
      sentAt: undefined,
      messageId: undefined,
      error: undefined,
      sendAttempts: 0,
      lastAttempt: undefined,
      analytics: {
        views: 0,
        reactions: new Map(),
        forwards: 0,
        replies: 0,
        pollVotes: 0,
        engagement: 0
      }
    });
    return duplicatedPost.save();
  }
};

// Statics do modelo
scheduledPostSchema.statics = {
  // Buscar posts por status
  async findByStatus(status, options = {}) {
    return this.find({ status, ...options }).sort({ scheduledTime: 1 });
  },

  // Buscar posts pendentes
  async findPending() {
    return this.find({
      status: 'pending',
      scheduledTime: { $lte: new Date() }
    }).sort({ scheduledTime: 1 });
  },

  // Buscar posts com melhor engagement
  async findTopEngagement(limit = 10) {
    return this.find({ status: 'sent' })
      .sort({ 'analytics.engagement': -1 })
      .limit(limit);
  },

  // Estatísticas de posts por período
  async getStats(startDate, endDate) {
    const stats = await this.aggregate([
      {
        $match: {
          scheduledTime: { $gte: startDate, $lte: endDate },
          status: 'sent'
        }
      },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalViews: { $sum: '$analytics.views' },
          totalEngagement: { $avg: '$analytics.engagement' },
          typeDistribution: { $push: '$type' }
        }
      }
    ]);
    return stats[0] || null;
  }
};

module.exports = mongoose.model('ScheduledPost', scheduledPostSchema);