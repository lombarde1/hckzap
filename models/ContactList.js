const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    photo: { type: String },
    description: { type: String },
    quality: { type: String, enum: ['high_ticket', 'low_ticket'], default: 'low_ticket' },
    spamCount: { type: Number, default: 0 } // Adicionando a contagem de spam
  });
  
const contactListSchema = new mongoose.Schema({
  name: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  contacts: [contactSchema]
}, { timestamps: true });

module.exports = mongoose.model('ContactList', contactListSchema);