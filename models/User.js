const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');


const convertDate = (v) => {
  if (v && v.$date) {
    return new Date(v.$date);
  }
  return v;
};

const convertNumber = (v) => {
  if (v && v.$numberDouble === 'Infinity') {
    return Infinity;
  }
  return v;
};

const chatSchema = new mongoose.Schema({
  chatId: String,
  name: String,
  image: String,
  lastMessage: String,
  autoResponseSent: { type: Boolean, default: false },
  currentStep: { type: Number, default: 0 },
  userInputs: { type: Map, of: String, default: () => new Map() }
});

const whatsappInstanceSchema = new mongoose.Schema({
  name: String,
  key: { 
    type: String, 
    unique: true, 
    required: true,
    validate: {
      validator: function(v) {
        return v != null && v !== '';
      },
      message: props => `A chave da instância WhatsApp não pode ser nula ou vazia`
    }
  },
  autoResponse: {
    isActive: { type: Boolean, default: false },
    funnelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Funnel' }
  },
  welcomeMessage: {
    isActive: { type: Boolean, default: false },
    message: String,
    mediaType: { type: String, enum: ['none', 'image', 'audio', 'video'], default: 'none' },
    mediaUrl: String,
    caption: String
  },
  autoResponseReports: [{
    chatId: String,
    funnelId: mongoose.Schema.Types.ObjectId,
    timestamp: Date
  }],
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isConnected: { type: Boolean, default: false },
  whatsappName: String,
  createdAt: { type: Date, default: Date.now },
  chats: [chatSchema],  // Add this line to include chats in the whatsappInstanceSchema
  webhookUrl: String
});

const notificationSchema = new mongoose.Schema({
  title: String,
  content: String,
  icon: String,
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const stepSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'wait', 'conditional', 'input'],
    required: true
  },
  content: String,
  delay: Number,
  condition: String,
  thenContent: String,
  elseContent: String,
  inputKey: String,
  inputPrompt: String
});

const nodeSchema = new mongoose.Schema({
  id: String,
  type: {
    type: String,
    enum: ['message', 'input', 'condition', 'wait', 'image', 'audio', 'video', 'file'],
    required: true
  },
  content: String,
  position: {
    x: Number,
    y: Number
  },
  data: mongoose.Schema.Types.Mixed
});

const connectionSchema = new mongoose.Schema({
  sourceId: String,
  targetId: String,
  sourceHandle: String,
  targetHandle: String
});

const funnelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: String,
  createdAt: { type: Date, default: Date.now },
  nodes: [nodeSchema],
  connections: [connectionSchema]
});


const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  condition: { type: String, enum: ['all', 'startsWith', 'contains', 'equals', 'regex'], required: true },
  value: String,
  funnelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Funnel', required: true },
  isActive: { type: Boolean, default: true },
  activationCount: { type: Number, default: 0 }
});



const UserSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: {
    type: String,
    unique: true,
    required: true,
    validate: {
      validator: function(v) {
        // Remove todos os caracteres não numéricos
        const cleanedNumber = v.replace(/\D/g, '');
        // Verifica se o número limpo tem entre 10 e 15 dígitos
        return /^\d{10,15}$/.test(cleanedNumber);
      },
      message: props => `${props.value} não é um número de telefone válido!`
    }
  },
  username: {
    type: String,
    unique: true,
    required: true
  },
  password: String,
  resetPasswordCode: String,
  resetPasswordExpires: Date,
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  manualPlanActive: {
    type: Boolean,
    default: false
  },
  manualPlanValidUntil: Date,

  plan: {
    type: String,
    enum: [
      'gratuito', 
      'basico_monthly', 'basico_quarterly', 'basico_semiannual',
      'plus_monthly', 'plus_quarterly', 'plus_semiannual',
      'premium_monthly', 'premium_quarterly', 'premium_semiannual'
    ],
    default: 'gratuito'
  },
  funnelLimit: {
    type: Number,
    default: 50,
    set: convertNumber,
  },
  funnelUsage: {
    type: Number,
    default: 0
  },
  activeFunnels: {
    type: Number,
    default: 0
  },
  autoResponseLimit: {
    type: Number,
    default: 30
  },
  autoResponseCount: {
    type: Number,
    default: 0
  },
  elevenlabsApiKey: {
    type: String,
    default: null
},
elevenlabsVoiceId: {
    type: String,
    default: null
},
elevenlabsIntegrationActive: {
  type: Boolean,
  default: false
},
apiKey: {
  type: String,
  unique: true,
  sparse: true // Permite null/undefined
},
apiKeyCreatedAt: Date,
apiUsage: {
  dailyRequests: {
      type: Number,
      default: 0
  },
  lastRequestDate: Date,
  monthlyRequests: {
      type: Number,
      default: 0
  }
},
lastApiRequest: Date,
autoResponseCampaigns: [campaignSchema],
mercadopago: {
  xCsrfToken: String,
  cookie: String,
  xNewRelicId: String,
  integrationActive: { type: Boolean, default: false },
  appAccessToken: String // Novo campo para o Access Token do Mercado Pago App
},
paymentMapping: {
  type: Map,
  of: String,
  default: new Map()
},
  validUntil: Date,
  
  stripeCustomerId: String,
  stripeSubscriptionIde: String,
  
  notifications: [notificationSchema],
  whatsappInstances: [whatsappInstanceSchema],
  funnels: [funnelSchema],
  profileImage: {
    type: String,
    default: '/img/profile.jpeg'
  },
});


UserSchema.index({ 'whatsappInstances.name': 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ username: 1 });

UserSchema.pre('save', async function(next) {
  this.whatsappInstances = this.whatsappInstances.filter(instance => instance.key != null);

  if (this.isModified('funnelLimit') && this.funnelLimit && this.funnelLimit.$numberDouble === 'Infinity') {
    this.funnelLimit = 9999;
  }
  if (this.isModified('phone')) {
    this.phone = this.phone.replace(/\D/g, '');
  }
 // if (this.isModified('password')) {
  //  this.password = await bcrypt.hash(this.password, 10);
 // }
  next();
});


// Adicionar método para verificar limite de requisições
UserSchema.methods.checkApiLimit = async function() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Resetar contadores se for um novo dia
  if (!this.apiUsage?.lastRequestDate || this.apiUsage.lastRequestDate < today) {
      this.apiUsage = {
          ...this.apiUsage,
          dailyRequests: 0
      };
  }

  // Resetar contador mensal se for um novo mês
  if (!this.apiUsage?.lastRequestDate || 
      this.apiUsage.lastRequestDate.getMonth() !== now.getMonth()) {
      this.apiUsage.monthlyRequests = 0;
  }

  // Limites de API baseados no plano e período
  const limits = {
      gratuito: { daily: 0, monthly: 0 },
      
      // Plano Básico
      basico_monthly: { daily: 1000, monthly: 10000 },
      basico_quarterly: { daily: 1000, monthly: 10000 },
      basico_semiannual: { daily: 1000, monthly: 10000 },
      
      // Plano Plus
      plus_monthly: { daily: 5000, monthly: 50000 },
      plus_quarterly: { daily: 5000, monthly: 50000 },
      plus_semiannual: { daily: 5000, monthly: 50000 },
      
      // Plano Premium
      premium_monthly: { daily: Infinity, monthly: Infinity },
      premium_quarterly: { daily: Infinity, monthly: Infinity },
      premium_semiannual: { daily: Infinity, monthly: Infinity }
  };

  const userLimits = limits[this.plan] || limits.gratuito;

  // Se o plano não permite acesso à API, bloquear
  if (!PLAN_LIMITS[this.plan]?.api) {
      throw new Error('Seu plano atual não permite acesso à API. Faça upgrade para utilizar esta funcionalidade.');
  }

  // Verificar limite diário (exceto para plano premium que tem Infinity)
  if (userLimits.daily !== Infinity && this.apiUsage.dailyRequests >= userLimits.daily) {
      throw new Error(`Limite diário de ${userLimits.daily} requisições atingido`);
  }

  // Verificar limite mensal (exceto para plano premium que tem Infinity)
  if (userLimits.monthly !== Infinity && this.apiUsage.monthlyRequests >= userLimits.monthly) {
      throw new Error(`Limite mensal de ${userLimits.monthly} requisições atingido`);
  }

  // Atualizar contadores
  this.apiUsage = {
      ...this.apiUsage,
      dailyRequests: (this.apiUsage.dailyRequests || 0) + 1,
      monthlyRequests: (this.apiUsage.monthlyRequests || 0) + 1,
      lastRequestDate: now
  };
  
  this.lastApiRequest = now;

  await this.save();

  // Retornar informações sobre os limites
  return {
      success: true,
      limits: {
          plan: this.plan,
          daily: {
              limit: userLimits.daily,
              used: this.apiUsage.dailyRequests,
              remaining: userLimits.daily === Infinity ? 'Unlimited' : userLimits.daily - this.apiUsage.dailyRequests
          },
          monthly: {
              limit: userLimits.monthly,
              used: this.apiUsage.monthlyRequests,
              remaining: userLimits.monthly === Infinity ? 'Unlimited' : userLimits.monthly - this.apiUsage.monthlyRequests
          }
      }
  };
};

UserSchema.methods.isValidAdminPassword = async function(adminPassword) {
  return await bcrypt.compare(adminPassword, this.adminPassword);
};
/*/
UserSchema.methods.isValidPassword = async function(password) {
  try {
    return await bcrypt.compare(password, this.password);
  } catch (error) {
    console.error('Erro ao comparar senhas:', error);
    return false;
  }
};/*/

UserSchema.methods.isValidPassword = async function(password) {
  return this.password === password;
};


module.exports = mongoose.model('User', UserSchema);