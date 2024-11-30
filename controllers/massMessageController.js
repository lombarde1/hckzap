// controllers/massMessageController.js

const PLAN_LIMITS = require('../config/planLimits');
const User = require('../models/User');
const DailyUsage = require('../models/DailyUsage');
const ContactList = require('../models/ContactList');
const { logUserActivity, ActivityTypes } = require('../Helpers/activityHistoryHelpers');
const MassMessageReport = require('../models/MassMessageReport');
const { executeFunnel } = require('../services/funnelExecutor');
const redisClient = require('../config/redisConfig');
const { v4: uuidv4 } = require('uuid');
const LimitsService = require('../services/limitsService');
const { updateDailyUsage } = require('../Helpers/usageHelper');

let activeJobs = new Map();


const MASS_MESSAGE_EXPIRY = 60 * 60 * 24; // 24 horas em segundos

exports.renderMassMessagePage = async (req, res) => {
    try {
        const userId = req.user.id;
        const funnelsKey = `user:${userId}:funnels`;
        const funnelIds = await redisClient.smembers(funnelsKey);

        const funnels = await Promise.all(funnelIds.map(async (funnelId) => {
            const funnelData = await redisClient.get(`funnel:${funnelId}`);
            return JSON.parse(funnelData);
        }));

        console.log('Funis carregados:', funnels);

        const user = await User.findById(userId).populate('whatsappInstances');
        
        if (!user) {
            return res.status(404).render('error', { message: 'Usuário não encontrado' });
        }

        const contactLists = await ContactList.find({ user: userId });

        res.render('mass-message', { 
            user: req.user,
            funnels: funnels,
            instances: user.whatsappInstances.filter(instance => instance.isConnected),
            contactLists: contactLists // Adicionando as listas de contatos aqui
        });
    } catch (error) {
        console.error('Erro ao carregar página de mensagem em massa:', error);
        res.status(500).render('error', { message: 'Erro ao carregar página' });
    }
};

exports.startMassMessage = async (req, res) => {
    const { listId, spamFilter, qualityFilter, funnelName, instanceIds, alternateInstances, waitTime, numbers } = req.body;
    const userId = req.user.id;

    try {
        let numberList = [];

        if (listId) {
            const contactList = await ContactList.findOne({ _id: listId, user: userId });
            if (!contactList) {
                return res.status(404).json({ error: 'Lista de contatos não encontrada' });
            }

            let filteredContacts = contactList.contacts;

            if (spamFilter) {
                filteredContacts = filteredContacts.filter(contact => contact.spamCount < parseInt(spamFilter, 10));
            }

            if (qualityFilter && qualityFilter !== 'all') {
                filteredContacts = filteredContacts.filter(contact => contact.quality === qualityFilter);
            }

            numberList = filteredContacts.map(contact => contact.phoneNumber);
        } else {
            numberList = numbers;
        }

        numberList = numberList.map(num => num.toString().trim()).filter(num => num);

        if (numberList.length === 0) {
            return res.status(400).json({ error: 'Nenhum número válido fornecido' });
        }
  
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
      }
  /*/
      const today = new Date();
      today.setHours(0, 0, 0, 0);
  
      let dailyUsage = await DailyUsage.findOne({ userId: user._id, date: today });
      if (!dailyUsage) {
        dailyUsage = new DailyUsage({ userId: user._id, date: today });
      }
  
      const dailyLimit = PLAN_LIMITS[user.plan].dailySpamMessages;
      const remainingLimit = dailyLimit - dailyUsage.spamMessages;
  
      if (numberList.length > remainingLimit) {
        return res.status(400).json({ error: `Limite diário excedido. Você pode enviar mais ${remainingLimit} mensagens hoje.` });
      }

/*/
const result = await LimitsService.checkAndUpdateUsage(userId, 'dailySpamMessages', numberList.length);
if (!result.success) {
    return res.status(400).json({ 
        error: `Limite diário excedido`,
        current: result.currentUsage,
        limit: result.limit,
        remaining: result.remaining
    });
}

      
    

        const funnelsKey = `user:${userId}:funnels`;
        const funnelIds = await redisClient.smembers(funnelsKey);
        let selectedFunnel = null;

        for (const funnelId of funnelIds) {
            const funnelData = await redisClient.get(`funnel:${funnelId}`);
            const funnel = JSON.parse(funnelData);
            if (funnel.name === funnelName) {
                selectedFunnel = funnel;
                break;
            }
        }

        if (!selectedFunnel) {
            console.log('Funil não encontrado:', funnelName);
            console.log('Funis disponíveis:', await Promise.all(funnelIds.map(async id => {
                const data = await redisClient.get(`funnel:${id}`);
                return JSON.parse(data).name;
            })));
            return res.status(404).json({ error: 'Funil não encontrado' });
        }

        
        const selectedInstances = user.whatsappInstances.filter(
            instance => instanceIds.includes(instance._id.toString())
        );

        if (selectedInstances.length === 0) {
            return res.status(400).json({ error: 'Nenhuma instância válida selecionada' });
        }

        await logUserActivity(userId, ActivityTypes.MASS_MESSAGE, {
            totalRecipients: numberList.length,
            funnelName: selectedFunnel.name,
            instanceNames: selectedInstances.map(i => i.name)
        });
        
        const report = new MassMessageReport({
            user: userId,
            funnelName: selectedFunnel.name,
            totalNumbers: numberList.length,
            startTime: new Date()
        });
        await report.save();

        const jobId = uuidv4();
        const job = {
            id: jobId,
            numbers: numberList,
            funnel: selectedFunnel,
            instances: selectedInstances,
            currentIndex: 0,
            report: report,
            isStopped: false,
            alternateInstances: alternateInstances,
            waitTime: waitTime // Adicione esta linha
        };
        activeJobs.set(jobId, job);
        // Inicie o processamento do job de forma assíncrona
        processJob(job, userId);

        res.json({ reportId: report._id.toString(), jobId: jobId, totalNumbers: numberList.length });
    } catch (error) {
        console.error('Erro ao iniciar envio em massa:', error);
        res.status(500).json({ error: 'Erro ao iniciar envio em massa' });
    }
};

async function processJob(job, userId) {
    const { numbers, funnel, instances, report, waitTime } = job;
    let currentInstanceIndex = 0;
    const user = await User.findById(userId);

    for (let i = job.currentIndex; i < numbers.length && !job.isStopped; i++) {
        if (job.isStopped) break;

        const instance = job.alternateInstances
            ? instances[currentInstanceIndex % instances.length]
            : instances[0];
        
        try {
            user.funnelUsage += 1;
            await user.save();

            console.log(`Processando número ${numbers[i]} usando instância ${instance.name}`);
            
            const chatId = `${numbers[i]}@s.whatsapp.net`;
            const autoResponseKey = `auto_response:${instance.name}:${chatId}`;
            
            const initialState = {
                funnelId: funnel.id,
                currentNodeId: funnel.nodes[0].id,
                status: 'in_progress',
                userInputs: {},
                lastMessage: ''
            };

            await redisClient.setex(autoResponseKey, 3600, JSON.stringify(initialState));

            await executeFunnel(funnel, chatId, instance.name, initialState);

            report.sent += 1;

            const contactList = await ContactList.findOne({ user: userId, 'contacts.phoneNumber': numbers[i] });
    if (contactList) {
        const contact = contactList.contacts.find(c => c.phoneNumber === numbers[i]);
        if (contact) {
            contact.spamCount += 1;
            await contactList.save();
        }
    }

            console.log(`Funil iniciado para ${numbers[i]} usando instância ${instance.name}`);

              // Adicione a lógica de espera aqui
              if (waitTime > 0 && i < numbers.length - 1) {
                console.log(`Aguardando ${waitTime} segundos antes do próximo envio...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }


        } catch (error) {
            console.error(`Erro ao processar número ${numbers[i]} usando instância ${instance.name}:`, error);
            report.errors += 1;
        }

        job.currentIndex = i + 1;
        if (job.alternateInstances) {
            currentInstanceIndex++;
        }
        await report.save();

        if ((i + 1) % 10 === 0 || i === numbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (job.isStopped) break;
    }

    if (job.currentIndex >= numbers.length || job.isStopped) {
        report.endTime = new Date();
        report.isCompleted = true;
        await report.save();
        activeJobs.delete(job.id);
    }
}

exports.getProgress = async (req, res) => {
    const { reportId } = req.query;
    try {
        const report = await MassMessageReport.findById(reportId);
        if (!report) {
            return res.status(404).json({ error: 'Relatório não encontrado' });
        }
        res.json({
            sent: report.sent,
            errors: report.errors,
            total: report.totalNumbers,
            isCompleted: report.isCompleted
        });
    } catch (error) {
        console.error('Erro ao obter progresso:', error);
        res.status(500).json({ error: 'Erro ao obter progresso' });
    }
};

exports.stopMassMessage = async (req, res) => {
    const { jobId } = req.body;
    console.log('Tentando interromper job com jobId:', jobId);
    console.log('Jobs ativos:', Array.from(activeJobs.keys()));

    try {
        const job = activeJobs.get(jobId);
        if (job) {
            job.isStopped = true;
            const report = job.report;
            if (report) {
                report.isCompleted = true;
                report.endTime = new Date();
                await report.save();
                console.log('Job interrompido com sucesso:', jobId);
                res.json({ 
                    message: 'Envio em massa interrompido com sucesso',
                    sent: report.sent,
                    errors: report.errors,
                    total: report.totalNumbers
                });
            } else {
                console.log('Relatório não encontrado para o jobId:', jobId);
                res.status(404).json({ error: 'Relatório não encontrado' });
            }
            activeJobs.delete(jobId);
        } else {
            console.log('Job não encontrado para o jobId:', jobId);
            res.status(404).json({ error: 'Job não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao interromper envio em massa:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};