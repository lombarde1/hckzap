// Helpers/usageHelper.js

const DailyUsage = require('../models/DailyUsage');
const PLAN_LIMITS = require('../config/planLimits');
const redisClient = require('../config/redisConfig');

exports.checkAndUpdateDailyUsage = async (userId, plan, usageType, amount) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        let dailyUsage = await DailyUsage.findOne({ userId, date: today });
        if (!dailyUsage) {
            dailyUsage = new DailyUsage({ userId, date: today });
        }

        const limitField = `daily${usageType}`;
        const usageField = usageType.toLowerCase();
        const dailyLimit = PLAN_LIMITS[plan][limitField];
        const currentUsage = dailyUsage[usageField];

        if (currentUsage + amount > dailyLimit) {
            return false;
        }

        dailyUsage[usageField] += amount;
        await dailyUsage.save();

        // Atualizar cache no Redis
        const cacheKey = `daily_usage:${userId}:${usageField}:${today.toISOString().split('T')[0]}`;
        await redisClient.set(cacheKey, dailyUsage[usageField], 'EX', 86400); // expira em 24h

        return true;
    } catch (error) {
        console.error(`Erro ao verificar e atualizar uso diário de ${usageType}:`, error);
        throw error;
    }
};

exports.incrementUsage = async (userId, usageType) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        const dailyUsage = await DailyUsage.findOneAndUpdate(
            { userId, date: today },
            { $inc: { [usageType]: 1 } },
            { upsert: true, new: true }
        );

        // Atualizar cache no Redis
        const cacheKey = `daily_usage:${userId}:${usageType}:${today.toISOString().split('T')[0]}`;
        await redisClient.set(cacheKey, dailyUsage[usageType], 'EX', 86400);

        return dailyUsage[usageType];
    } catch (error) {
        console.error(`Erro ao incrementar uso de ${usageType}:`, error);
        throw error;
    }
};

exports.getUserDailyUsage = async (userId) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        let dailyUsage = await DailyUsage.findOne({ userId, date: today });
        
        if (!dailyUsage) {
            dailyUsage = new DailyUsage({ 
                userId, 
                date: today,
                spamMessages: 0,
                autoResponses: 0
            });
            await dailyUsage.save();
        }

        return dailyUsage;
    } catch (error) {
        console.error('Erro ao obter uso diário:', error);
        throw error;
    }
};

exports.updateDailyUsage = async (userId, field, increment) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
        const result = await DailyUsage.findOneAndUpdate(
            { userId, date: today },
            { $inc: { [field]: increment } },
            { upsert: true, new: true }
        );

        // Atualizar cache no Redis
        const cacheKey = `daily_usage:${userId}:${field}:${today.toISOString().split('T')[0]}`;
        await redisClient.set(cacheKey, result[field], 'EX', 86400);

        console.log(`Uso diário atualizado para ${userId}: ${field} incrementado em ${increment}`);
        return result;
    } catch (error) {
        console.error('Erro ao atualizar uso diário:', error);
        throw error;
    }
};