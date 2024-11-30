const mongoose = require('mongoose');
const User = require('./models/User'); // Ajuste o caminho conforme necessário

mongoose.connect('mongodb://darkvips:lombarde1@147.79.111.143:27017/hocket?authSource=admin', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
async function migratePlans() {
  try {
    // Busque todos os usuários com planos antigos
    const users = await User.find({
      plan: { $in: ['basico', 'plus', 'premium'] }
    });

    console.log(`Encontrados ${users.length} usuários para migração.`);

    for (const user of users) {
      // Mapeie o plano antigo para o novo formato
      const newPlan = `${user.plan}_monthly`;

      // Atualize o plano do usuário
      await User.findByIdAndUpdate(user._id, { plan: newPlan });

      console.log(`Usuário ${user.username} migrado de ${user.plan} para ${newPlan}`);
    }

    console.log('Migração concluída com sucesso!');
  } catch (error) {
    console.error('Erro durante a migração:', error);
  } finally {
    // Feche a conexão com o banco de dados
    mongoose.connection.close();
  }
}

migratePlans();