// telegram.js
const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
const cron = require('node-cron');
const { ensureAuthenticated } = require('../middleware/auth');
const ScheduledPost = require('../models/ScheduledPost');
const TelegramGroup = require('../models/TelegramGroup');

class TelegramBotService {
  constructor(token) {
    this.bot = new TelegramBot(token, { polling: true });
    this.initializeEventHandlers();
    this.initializeScheduler();
  }

  // Inicialização de handlers de eventos
  initializeEventHandlers() {
    this.bot.on('message', this.handleNewMessage.bind(this));
    this.bot.on('error', (error) => console.error('Bot error:', error));
    this.bot.on('polling_error', (error) => console.error('Polling error:', error));
  }

  // Handler para novos mensagens
  async handleNewMessage(msg) {
    try {
      if (msg.new_chat_members?.some(member => member.username === this.bot.options.username)) {
        await this.handleBotAddedToGroup(msg.chat.id);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  // Handler para quando o bot é adicionado a um grupo
  async handleBotAddedToGroup(chatId) {
    try {
      const group = await TelegramGroup.findOne({ telegramId: chatId.toString() });
      if (!group) {
        const hasPermission = await this.checkBotPermissions(chatId);
        if (!hasPermission) {
          await this.bot.sendMessage(chatId, 'Por favor, me conceda permissões de administrador para funcionar corretamente.');
        }
      }
    } catch (error) {
      console.error('Error handling bot added to group:', error);
    }
  }

  // Verificação de permissões do bot
  async checkBotPermissions(chatId) {
    try {
      const botMember = await this.bot.getChatMember(chatId, this.bot.options.username);
      return botMember.can_post_messages;
    } catch (error) {
      console.error(`Error checking bot permissions in group ${chatId}:`, error);
      return false;
    }
  }

  // Inicialização do agendador
  initializeScheduler() {
    cron.schedule('* * * * *', this.processPendingPosts.bind(this));
  }

  // Processamento de posts pendentes
  async processPendingPosts() {
    try {
      const now = moment();
      const pendingPosts = await ScheduledPost.find({
        scheduledTime: { $lte: now.toDate() },
        status: 'pending'
      });

      await Promise.all(pendingPosts.map(post => this.sendScheduledPost(post)));
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  }

  // Envio de post agendado
  async sendScheduledPost(post) {
    try {
      const group = await TelegramGroup.findById(post.groupId);
      if (!group) throw new Error('Group not found');

      const hasPermission = await this.checkBotPermissions(group.telegramId);
      if (!hasPermission) throw new Error('Insufficient permissions in group');

      const messageResult = await this.sendMessage(group.telegramId, post);
      
      await this.updatePostStatus(post, 'sent', messageResult);
      
      if (post.recurringSchedule?.enabled) {
        await this.scheduleNextRecurringPost(post);
      }
    } catch (error) {
      await this.updatePostStatus(post, 'failed', null, error.message);
      console.error('Error sending scheduled post:', error);
    }
  }

  // Envio de mensagem baseado no tipo
  async sendMessage(chatId, post) {
    switch (post.type) {
      case 'text':
        return await this.bot.sendMessage(chatId, post.content, { parse_mode: 'HTML' });
      case 'photo':
        return await this.bot.sendPhoto(chatId, post.mediaUrl, { caption: post.caption, parse_mode: 'HTML' });
      case 'video':
        return await this.bot.sendVideo(chatId, post.mediaUrl, { caption: post.caption, parse_mode: 'HTML' });
      case 'poll':
        return await this.bot.sendPoll(chatId, post.poll.question, post.poll.options, {
          is_anonymous: false,
          allows_multiple_answers: post.poll.multipleChoice,
          correct_option_id: post.poll.quizMode ? post.poll.correctOption : undefined
        });
      default:
        throw new Error('Unknown post type');
    }
  }

  // Atualização do status do post
  async updatePostStatus(post, status, messageResult = null, error = null) {
    post.status = status;
    post.sentAt = status === 'sent' ? new Date() : undefined;
    post.messageId = messageResult?.message_id;
    post.error = error;
    post.lastAttempt = new Date();
    post.sendAttempts += 1;
    await post.save();
  }

  // Agendamento do próximo post recorrente
  async scheduleNextRecurringPost(post) {
    try {
      const nextSchedule = this.calculateNextSchedule(post.recurringSchedule, post.scheduledTime);
      if (nextSchedule && (!post.recurringSchedule.endDate || nextSchedule < post.recurringSchedule.endDate)) {
        const newPost = new ScheduledPost({
          ...post.toObject(),
          _id: undefined,
          scheduledTime: nextSchedule,
          status: 'pending',
          sentAt: undefined,
          messageId: undefined,
          error: undefined,
          sendAttempts: 0,
          lastAttempt: undefined
        });
        await newPost.save();
      }
    } catch (error) {
      console.error('Error scheduling next recurring post:', error);
    }
  }

  // Cálculo do próximo agendamento
  calculateNextSchedule(recurringSchedule, lastSchedule) {
    const next = moment(lastSchedule);
    
    switch (recurringSchedule.frequency) {
      case 'daily':
        next.add(1, 'day');
        break;
      case 'weekly':
        if (recurringSchedule.daysOfWeek?.length) {
          let found = false;
          let currentDay = next.day();
          for (let i = 1; i <= 7 && !found; i++) {
            currentDay = (currentDay + 1) % 7;
            if (recurringSchedule.daysOfWeek.includes(currentDay)) {
              next.add(i, 'days');
              found = true;
            }
          }
        } else {
          next.add(1, 'week');
        }
        break;
      case 'monthly':
        next.add(1, 'month');
        break;
      case 'custom':
        if (recurringSchedule.customInterval) {
          next.add(recurringSchedule.customInterval.value, recurringSchedule.customInterval.unit);
        }
        break;
    }

    if (recurringSchedule.timeOfDay) {
      const [hour, minute] = recurringSchedule.timeOfDay.split(':');
      next.set({ hour, minute, second: 0 });
    }
    
    return next.toDate();
  }
}

// Instanciando o serviço do bot
const botService = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN || '7719419601:AAGwOkbmamyCcFjyyLr11V9tIZn_sVWFZMI');

// Rotas da API
router.post('/groups', ensureAuthenticated, async (req, res) => {
  try {
    const { telegramId } = req.body;
    const chat = await botService.bot.getChat(telegramId);
    
    if (!['supergroup', 'group'].includes(chat.type)) {
      return res.status(400).json({ error: 'Invalid ID or not a group' });
    }

    const existingGroup = await TelegramGroup.findOne({ telegramId });
    if (existingGroup) {
      return res.status(400).json({ error: 'Group already exists' });
    }

    const group = new TelegramGroup({
      userId: req.user.id,
      telegramId,
      title: chat.title,
      addedAt: new Date()
    });

    await group.save();
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/groups', ensureAuthenticated, async (req, res) => {
  try {
    const groups = await TelegramGroup.find({ userId: req.user.id });
    const updatedGroups = await Promise.all(groups.map(async (group) => {
      try {
        const chat = await botService.bot.getChat(group.telegramId);
        const memberCount = await botService.bot.getChatMembersCount(group.telegramId);
        
        return await group.updateStats({
          memberCount,
          title: chat.title,
          lastUpdated: new Date()
        });
      } catch (error) {
        console.error(`Error updating group ${group.telegramId}:`, error);
        return group;
      }
    }));

    res.json(updatedGroups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/groups/:groupId/members', ensureAuthenticated, async (req, res) => {
  try {
    const group = await TelegramGroup.findOne({
      _id: req.params.groupId,
      userId: req.user.id
    });
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const chatAdmins = await botService.bot.getChatAdministrators(group.telegramId);
    const members = chatAdmins.map(member => ({
      id: member.user.id,
      username: member.user.username,
      firstName: member.user.first_name,
      lastName: member.user.last_name,
      isAdmin: true,
      permissions: {
        canPostMessages: member.can_post_messages,
        canEditMessages: member.can_edit_messages,
        canDeleteMessages: member.can_delete_messages,
        canRestrictMembers: member.can_restrict_members,
        canPromoteMembers: member.can_promote_members
      }
    }));

    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/groups/:groupId', ensureAuthenticated, async (req, res) => {
  try {
    const group = await TelegramGroup.findOneAndDelete({
      _id: req.params.groupId,
      userId: req.user.id
    });
    
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    await ScheduledPost.deleteMany({ groupId: req.params.groupId });
    res.json({ message: 'Group successfully removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;