// models/OnlineInstance.js
const mongoose = require('mongoose');

const onlineInstanceSchema = new mongoose.Schema({
    instanceKey: {
        type: String,
        required: true,
        unique: true
    },
    number: {
        type: String,
        required: true
    },
    token: String,
    lastSeen: {
        type: Date,
        default: Date.now
    },
    sessionData: {
        startTime: Date,
        totalInteractions: {
            type: Number,
            default: 0
        },
        successfulInteractions: {
            type: Number,
            default: 0
        }
    }
}, {
    timestamps: true
});

// Índice para melhorar performance de buscas por lastSeen
onlineInstanceSchema.index({ lastSeen: 1 });

const OnlineInstance = mongoose.model('OnlineInstance', onlineInstanceSchema);
module.exports = OnlineInstance;