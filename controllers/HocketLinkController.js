const HocketLink = require('../models/HocketLink');
const PLAN_LIMITS = require('../config/planLimits');

const hocketLinkController = {
  // Criar novo link
  async createLink(req, res) {
    try {
      const { 
        customPath, 
        name, 
        numbers, 
        redirectType, 
        customMessage,
        messageDelay,
        metaTags 
      } = req.body;

      // Verificar limite do plano
      const userLinks = await HocketLink.countDocuments({ user: req.user.id });
      const planLimit = PLAN_LIMITS[req.user.plan].hocketLinks || 0;
      
      if (userLinks >= planLimit) {
        return res.status(403).json({
          success: false,
          message: 'You have reached the maximum number of links allowed in your plan'
        });
      }

      // Verificar se o customPath já existe
      const existingLink = await HocketLink.findOne({ customPath });
      if (existingLink) {
        return res.status(400).json({
          success: false,
          message: 'This custom path is already in use'
        });
      }

      const link = new HocketLink({
        user: req.user.id,
        customPath,
        name,
        numbers: numbers.map(number => ({
          whatsappNumber: number.replace(/\D/g, ''),
          isActive: true
        })),
        redirectType,
        customMessage,
        messageDelay,
        metaTags
      });

      await link.save();

      res.status(201).json({
        success: true,
        data: link
      });
    } catch (error) {
      console.error('Error creating link:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating link',
        error: error.message
      });
    }
  },

  // Obter todos os links do usuário
  async getLinks(req, res) {
    try {
      const links = await HocketLink.find({ user: req.user.id })
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        data: links
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching links',
        error: error.message
      });
    }
  },

  // Obter link específico
  async getLink(req, res) {
    try {
      const link = await HocketLink.findOne({
        _id: req.params.id,
        user: req.user.id
      });

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      res.json({
        success: true,
        data: link
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching link',
        error: error.message
      });
    }
  },

  // Atualizar link
  async updateLink(req, res) {
    try {
      const {
        name,
        numbers,
        redirectType,
        customMessage,
        messageDelay,
        metaTags,
        isActive
      } = req.body;

      const link = await HocketLink.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id },
        {
          name,
          numbers: numbers.map(number => ({
            whatsappNumber: number.replace(/\D/g, ''),
            isActive: true
          })),
          redirectType,
          customMessage,
          messageDelay,
          metaTags,
          isActive,
          updatedAt: new Date()
        },
        { new: true, runValidators: true }
      );

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      res.json({
        success: true,
        data: link
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error updating link',
        error: error.message
      });
    }
  },

  // Excluir link
  async deleteLink(req, res) {
    try {
      const link = await HocketLink.findOneAndDelete({
        _id: req.params.id,
        user: req.user.id
      });

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      res.json({
        success: true,
        message: 'Link deleted successfully'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error deleting link',
        error: error.message
      });
    }
  },

  // Obter estatísticas do link
  async getLinkStats(req, res) {
    try {
      const link = await HocketLink.findOne({
        _id: req.params.id,
        user: req.user.id
      });

      if (!link) {
        return res.status(404).json({
          success: false,
          message: 'Link not found'
        });
      }

      // Agregar estatísticas
      const stats = {
        totalClicks: link.stats.clicks,
        lastClick: link.stats.lastClick,
        clicksByNumber: {},
        clicksByDay: {},
        recentRedirects: link.stats.redirectHistory.slice(-10)
      };

      // Calcular cliques por número
      link.stats.redirectHistory.forEach(redirect => {
        stats.clicksByNumber[redirect.number] = (stats.clicksByNumber[redirect.number] || 0) + 1;
        
        const day = new Date(redirect.timestamp).toISOString().split('T')[0];
        stats.clicksByDay[day] = (stats.clicksByDay[day] || 0) + 1;
      });

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching link statistics',
        error: error.message
      });
    }
  }
};

module.exports = hocketLinkController;