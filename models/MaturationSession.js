const mongoose = require('mongoose');

const maturationActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['group_extraction', 'owner_message', 'p2p_communication'],
    required: true
  },
  details: {
    groupName: String,
    ownerNumber: String,
    messageContent: String,
    success: Boolean,
    error: String
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const aquecimentoSessionschema = new mongoose.Schema({
  instanceKey: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'error'],
    default: 'active'
  },
  methods: {
    groupOwnerInteraction: {
      enabled: Boolean,
      dailyLimit: Number,
      currentCount: Number
    },
    p2pCommunication: {
      enabled: Boolean,
      onlineStatus: Boolean,
      lastConnection: Date,
      currentCount: Number
    }
  },
  configuration: {
    durationDays: Number,
    startDate: Date,
    endDate: Date,
    messageDelay: {
      type: Number,
      default: 2000 // 2 segundos por padrão
    },
    extractionDelay: {
      type: Number,
      default: 5000 // 5 segundos por padrão
    }
  },
  progress: {
    totalGroups: Number,
    processedGroups: Number,
    successfulInteractions: Number,
    failedInteractions: Number,
    percentageComplete: Number
  },
  nextScheduledAction: {
    type: Date,  // Hora da próxima ação agendada
    required: true
  },
  activities: [maturationActivitySchema],
  lastActivity: Date,
  nextScheduledAction: Date
}, {
  timestamps: true
});

// Índices para melhorar performance de consultas
aquecimentoSessionschema.index({ userId: 1, instanceKey: 1 });
aquecimentoSessionschema.index({ status: 1 });
aquecimentoSessionschema.index({ 'methods.p2pCommunication.onlineStatus': 1 });

// Método para atualizar progresso
aquecimentoSessionschema.methods.updateProgress = async function() {
  const total = this.activities.length;
  const successful = this.activities.filter(a => a.details.success).length;
  
  this.progress = {
    totalGroups: total,
    processedGroups: this.activities.filter(a => a.type === 'group_extraction').length,
    successfulInteractions: successful,
    failedInteractions: total - successful,
    percentageComplete: (total > 0 ? (successful / total) * 100 : 0).toFixed(2)
  };

  await this.save();
};

// Método para verificar limites de uso
aquecimentoSessionschema.methods.checkLimits = function() {
  const now = new Date();
  if (now > this.configuration.endDate) {
    this.status = 'completed';
    return false;
  }

  if (this.methods.groupOwnerInteraction.enabled &&
      this.methods.groupOwnerInteraction.currentCount >= this.methods.groupOwnerInteraction.dailyLimit) {
    return false;
  }

  return true;
};

const MaturationSession = mongoose.model('aquecimentoSession', aquecimentoSessionschema);
module.exports = MaturationSession;