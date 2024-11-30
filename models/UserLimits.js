// models/UserLimits.js
const mongoose = require('mongoose');

const userLimitsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    // Limites personalizados
    customLimits: {
        whatsappConnections: {
            limit: Number,
            isCustom: { type: Boolean, default: false }
        },
        dailySpamMessages: {
            limit: Number,
            isCustom: { type: Boolean, default: false }
        },
        dailyAutoResponses: {
            limit: Number,
            isCustom: { type: Boolean, default: false }
        },
        funnels: {
            limit: Number,
            isCustom: { type: Boolean, default: false }
        },
        groupManagement: {
            enabled: Boolean,
            isCustom: { type: Boolean, default: false }
        },
        hocketLinks: {
            limit: Number,
            isCustom: { type: Boolean, default: false }
        }
    },
    // Override temporário
    temporaryLimits: [{
        type: {
            type: String,
            enum: ['whatsappConnections', 'dailySpamMessages', 'dailyAutoResponses', 'funnels', 'hocketLinks']
        },
        limit: Number,
        expiresAt: Date
    }]
}, { timestamps: true });

module.exports = mongoose.model('UserLimits', userLimitsSchema);
