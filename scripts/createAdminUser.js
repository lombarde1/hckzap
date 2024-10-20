const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

mongoose.connect('mongodb://darkvips:lombarde1@147.79.111.143:27017/', { useNewUrlParser: true, useUnifiedTopology: true });

async function createAdminUser() {
    try {
      const password = await bcrypt.hash('admin123', 10);
      
      const user = new User({
        name: 'Dark admin',
        phone: '5517991134416',
        username: 'darkhigor',
        password: 'lombarde1',
        role: 'admin',
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      });
  
      await user.save();
      console.log('Usuário admin criado com sucesso');
      mongoose.connection.close();
    } catch (error) {
      console.error('Erro ao criar usuário admin:', error);
      mongoose.connection.close();
    }
  }
  
  createAdminUser();