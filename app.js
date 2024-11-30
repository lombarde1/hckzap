require('dotenv').config();
const eventBus = require('./Helpers/eventBus');
const analyticsController = require('./controllers/analyticsController');
const { ensureAuthenticated } = require('./middleware/auth');
const settingsController = require('./controllers/settingsController');

// Verificação da chave API
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('A chave secreta do Stripe não está definida. Por favor, configure a variável de ambiente STRIPE_SECRET_KEY.');
  process.exit(1);
}

const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const User = require('./models/User');
const app = express();
const fs = require('fs');
const path = require('path');
const multer = require("multer");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require("axios")
const funnelController = require('./controllers/funnelController');
// Cria o diretório de uploads se ele não existir
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Conectar ao MongoDB
mongoose.connect('mongodb://darkvips:lombarde1@147.79.111.143:27017/hocket', { useNewUrlParser: true, useUnifiedTopology: true, authSource: 'admin'  });

// Configurações
const expressLayouts = require('express-ejs-layouts');

const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: ["https://dev.hocketzap.com", "https://agenciaspicy.vercel.app", "http://localhost:5173", "https://cresca-em-30-dias.vercel.app"],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    credentials: true
  }
});


const { getChats, getMessages, saveAndSendMessage } = require('./Helpers/redisHelpers');

app.set('io', io);

io.on('connection', (socket) => {
  console.log('Um usuário se conectou');
  
  socket.on('join instance', (instanceKey) => {
      console.log(`Cliente tentando entrar na instância: ${instanceKey}`);
      socket.join(instanceKey);
      console.log(`Cliente entrou na instância: ${instanceKey}`);
  });

  // Adicione este novo evento
  socket.on('load chats', async (instanceKey) => {
    try {
      const chats = await getChats(instanceKey);
 
      socket.emit('chats loaded', chats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp));
    } catch (error) {
      console.error('Erro ao carregar chats:', error);
      socket.emit('chats load error', { message: 'Erro ao carregar chats' });
    }
  });

  socket.on('request initial chats', async (instanceKey) => {
      const chats = await fetchInitialChats(instanceKey);
      socket.emit('initial chats', chats);
  });

  socket.on('request chat messages', async (instanceKey, chatId) => {
      const messages = await fetchChatMessages(instanceKey, chatId);
      socket.emit('chat messages', { chatId, messages });
  });

  socket.on('send message', async (data) => {
      const { instanceKey, chatId, content } = data;
      const message = await saveAndSendMessage(instanceKey, chatId, content);
      console.log("msg nova")
      io.to(instanceKey).emit('new message', { chatId, message });
  });

  socket.on('disconnect', () => {
      console.log('Um usuário se desconectou');
  });
});


const videoEditRoutes = require('./routes/videoEdit');
app.use('/video-edit', videoEditRoutes);

// Escutar eventos do eventBus e emitir para o socket
eventBus.on('newMessage', (instanceKey, data) => {
  console.log("EVENTBUS DE MENSAGEM NOVA")
  io.to(instanceKey).emit('new message', data);
});

eventBus.on('status', (instanceKey, data) => {
  console.log("EVENTBUS DE STATUS NOVO")
  io.to(instanceKey).emit('status', data);
});


async function fetchInitialChats(instanceKey) {
    try {
        const chats = await getChats(instanceKey);
        return chats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    } catch (error) {
        console.error('Erro ao buscar chats iniciais:', error);
        return [];
    }
}

async function fetchChatMessages(instanceKey, chatId, limit = 50) {
  try {
      const messages = await getMessages(instanceKey, chatId, limit);
      return messages.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
      console.error('Erro ao buscar mensagens do chat:', error);
      return [];
  }
}




app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');

// Aumentar o limite do body-parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static('public'));
app.use('/zap', express.static(path.join(__dirname, 'frontend', 'webzap')));
app.use('/integracoes', express.static(path.join(__dirname, 'frontend', 'integracoes')));


app.use('/funil', express.static(path.join(__dirname, 'frontend', 'funnelapp')));

// Rota de fallback para o SPA
app.get('/funil/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'funnelapp', 'index.html'));
});

// Configuração da sessão
app.use(session({
  secret: 'darklindo',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 semana
  },
  store: MongoStore.create({ mongoUrl: 'mongodb://darkvips:lombarde1@147.79.111.143:27017/' })
}));

// Configurar flash middleware
app.use(flash());

// Inicializar Passport
app.use(passport.initialize());
app.use(passport.session());
require('./config/passport')(passport);

app.use((req, res, next) => {
  req.io = io;
  res.locals = {
    ...res.locals,
    currentUrl: req.originalUrl,
    isCurrentPath: (path) => req.originalUrl === path,
    formatCategory: (cat) => cat.charAt(0).toUpperCase() + cat.slice(1),
    user: req.user || {},
    messages: req.flash()
  };
  res.locals.messages = req.flash();
  next();
});

// Tratamento de erros para Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    req.flash('error_msg', `Erro de upload: ${err.message}`);
    return res.redirect('/profile');
  } else if (err) {
    console.error(err);
    req.flash('error_msg', 'Ocorreu um erro durante o upload');
    return res.redirect('/profile');
  }
  next();
});

// Serialização do usuário
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Desserialização do usuário
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Rotas

const catalogRoutes = require('./routes/catalogRoutes');
app.use('/catalog', catalogRoutes);

const contactListRoutes = require('./routes/contactListRoutes');
app.use('/contact-lists', contactListRoutes);

// In app.js
const cartpandaRoutes = require('./routes/cartpanda');
app.use('/cartpanda', cartpandaRoutes);

const pageRoutes = require('./routes/pageRoutes');

// ... (outras configurações)

app.use('/pages', pageRoutes);

const subscriptionRoutes = require('./routes/subscription');
app.use('/subscription', subscriptionRoutes);
const webhookController = require('./controllers/webhookController');
app.post('/pagbank-pix', webhookController.handlePagBankPixWebhook);

const minioClient = require('./config/minioConfig');
const { Readable } = require('stream');



app.get('/webhook-tester', ensureAuthenticated, (req, res) => {
  res.render('webhook-tester', {
    user: req.user,
    instances: req.user.whatsappInstances || []
  });
});

app.post('/webhook-tester/simulate', ensureAuthenticated, async (req, res) => {
  try {
    const {
      instanceKey,
      messageType = 'conversation',
      message,
      mediaUrl = '',
      remoteJid // Novo parâmetro para o número de telefone
    } = req.body;

    // Simular estrutura do webhook do WhatsApp
    const webhookData = {
      event: 'messages.upsert',
      instance: instanceKey,
      data: {
        key: {
          remoteJid: remoteJid, // Usar o número fornecido
          fromMe: false,
          id: `TEST${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        },
        pushName: "Test User",
        messageTimestamp: Math.floor(Date.now() / 1000),
        messageType: messageType,
        message: {
          conversation: message
        }
      }
    };

    // Adicionar dados específicos para mensagens de mídia
    if (messageType !== 'conversation' && mediaUrl) {
      webhookData.data.message = {
        [messageType]: {
          url: mediaUrl,
          caption: message
        }
      };
    }

    // Log para debug
    console.log(`Simulando webhook para ${remoteJid}:`, webhookData);

    // Enviar webhook para o endpoint local
    const response =  axios.post('https://dev.hocketzap.com/webhook/evolution', webhookData);

    res.json({
      success: true,
      message: `Webhook simulado com sucesso para ${remoteJid}`,
      webhookResponse: response.data
    });

  } catch (error) {
    console.error('Erro ao simular webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : null
    });
  }
});

const whatsappCampaignRoutes = require('./routes/whatsappCampaign');
const redirectRoutes = require('./routes/redirect');

app.use('/api/whatsapp-campaigns', whatsappCampaignRoutes);
app.use('/r', redirectRoutes);

// Em qualquer arquivo onde você precisa usar essas funções:
const stripeHelpers = require('./Helpers/stripeHelpers');

// Exemplo de uso em uma rota ou controller:
app.post('/create-checkout-session', async (req, res) => {
    const { planKey } = req.body;
    const userId = req.user.id;
console.log(planKey)
    try {
        const session = await stripeHelpers.createCheckoutSession(
            userId,
            planKey,
            `${req.protocol}://${req.get('host')}/subscription/subscription-success?id={CHECKOUT_SESSION_ID}&userId=${req.user.id}`,
            `${req.protocol}://${req.get('host')}/change-plan`
        );

        res.json({ id: session.id });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: error.message });
    }
});


app.get('/events', (req, res) => {
  res.render('events', {user: req.user});
});

// Exemplo de uso da função getPlanFromPriceId:
app.get('/subscription-details', async (req, res) => {
    const subscription = await stripeHelpers.retrieveSubscription(req.user.stripeSubscriptionIde);
    const planName = stripeHelpers.getPlanFromPriceId(subscription.items.data[0].price.id);
    
    res.json({ plan: planName });
});
const cors = require('cors');
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000', 
    'https://dev.hocketzap.com',
    'https://cresca-em-30-dias.vercel.app',
    'https://agenciaspicy.vercel.app'  // Adicione seu domínio do Vercel
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
}));

const setupMinioPolicy = require('./config/setupMinio');

// ... resto do seu código ...

// Chamar durante a inicialização
setupMinioPolicy().catch(console.error);

// Rota para servir arquivos do MinIO
app.get('/media/:filename', async (req, res) => {
  try {
    const stream = await minioClient.getObject('chat-media', req.params.filename);
    stream.pipe(res);
  } catch (error) {
    console.error('Erro ao buscar arquivo:', error);
    res.status(404).send('Arquivo não encontrado');
  }
});

app.use('/', require('./routes/auth'));
app.use('/api-events', require('./routes/events'));

const zapprofileRoutes = require('./routes/zapprofileRoutes');
app.use('/zapprofile', zapprofileRoutes);
app.use('/profile', require('./routes/profile'));
app.use('/funcoes', require('./routes/someFeature'));
app.use('/admin', require('./routes/admin'));
app.use('/dashboard', require('./routes/dashboard'));

const webhookRouter = require('./routes/webhook');
app.use('/webhook', webhookRouter);

const limitlesroutes = require('./routes/limits');
app.use('/limits', limitlesroutes);

const whatsappInstancesRoutes = require('./routes/whatsappInstances');
app.use('/whatsapp', whatsappInstancesRoutes);

// app.js (adicionar esta linha)
const analyticsRoutes = require('./routes/analyticsRoutes');
app.use('/analisys', analyticsRoutes);

const chatCleanupRoutes = require('./routes/chatCleanupRoutes');
app.use('/clear', chatCleanupRoutes);

const funnelRoutes = require('./routes/funnelRoutes');
app.use('/funnels', funnelRoutes);

//const telegramRoutes = require('./routes/consulta');

//app.use('/consulta', telegramRoutes);

// app.js
const maturationRoutes = require('./routes/maturationRoutes');
app.use('/maturation', maturationRoutes);

const hocketLinkRoutes = require('./routes/hocketlink');
app.use('/hocket-links', hocketLinkRoutes);

const whatsappRoutes = require('./routes/funcoeszap');
app.use('/funcao', whatsappRoutes);


const activityHistoryRoutes = require('./routes/activityHistory');
app.use('/api/activities', activityHistoryRoutes);

//app.use('/group', require('./routes/groupManagement'));

app.use('/app', require('./routes/messages'));

app.use('/chat', require('./routes/chatRoutes'));

const autoResponseRouter = require('./routes/autoResponse');
app.use('/auto-response', autoResponseRouter);


app.get('/settings', ensureAuthenticated, settingsController.getSettings);
app.post('/settings/update', ensureAuthenticated, settingsController.updateSettings);

app.get('/analytics', ensureAuthenticated, analyticsController.getAnalytics);

const notificationsRoutes = require('./routes/notifications');
app.use('/notifications', notificationsRoutes);

const groupsr = require('./routes/groupRoutes');
app.use('/group', groupsr);

app.use('/integrations', require('./routes/integrations'));

const elevenlabsWhatsappRoutes = require('./routes/zapvoice-master');
app.use('/zapvoice', elevenlabsWhatsappRoutes);

const bankStatementRoutes = require('./routes/banco'); 
app.use('/banco', bankStatementRoutes);

const paymentRoutes = require('./routes/paymentRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

app.use('/payments', paymentRoutes);
app.use('/api/webhook', webhookRoutes);


app.post('/test-api-request', async (req, res) => {
  const { url, method, body, headers } = req.body;
  let parsedHeaders;
  
  try {
    // Se headers forem enviados como string JSON, parse para um objeto
    if (headers) {
      parsedHeaders = JSON.parse(headers); // Corrigido para transformar a string JSON em objeto
    }

    const response = await axios({
      method: method,
      url: url,
      data: body ? JSON.parse(body) : undefined,
      headers: parsedHeaders || {},  // Usa headers parseados
      timeout: 10000 // 10 segundos de timeout
    });

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      headers: response.headers
    });
  } catch (error) {
    console.log(error);
    console.log(parsedHeaders)
    res.status(500).json({
      success: false,
      error: error.message,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      } : null
    });
  }
});

// app.js

const apiRoutesDev = require('./routes/apiRoutesDev');
app.use('/api', apiRoutesDev);

const apiRoutes = require('./routes/apiRoutes');
app.use('/api/v1', apiRoutes);

app.get('/docs', async (req, res) => {
  res.sendFile(path.join(__dirname, 'docs.html')); 
});

app.get('/zap/*', async (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend','webzap', 'index.html'));
});

app.get('/integracoes/*', async (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'integracoes', 'index.html'));
});

// No seu app.js, adicione:
const pushinPayRoutes = require('./routes/pushinPay');
app.use('/pushinpay', pushinPayRoutes);

//const telegramRoutes = require('./routes/telegram');
//app.use('/api/telegram', telegramRoutes);

app.get('/telegram', (req, res) => {
  res.render('telegram', {user: req.user});
});

const pushinPayWebhookController = require('./controllers/pushinPayWebhookController');
app.post('/api/webhook/pushinpay/:token', pushinPayWebhookController.handleWebhook);

const PORT = process.env.PORT || 3332;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

module.exports = io;