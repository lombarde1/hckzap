// services/redisTimerService.js
const redisClient = require('../config/redisConfig');

class RedisTimerService {
    constructor() {
        this.TIMER_PREFIX = 'maturation_timer:';
        this.HISTORY_KEY = 'maturation_history';
        this.MAX_HISTORY = 50; // Mantém histórico das últimas 50 sessões
    }

    async saveTimer(sessionId, nextActionTime) {
        const key = this.TIMER_PREFIX + sessionId;
        await redisClient.set(key, nextActionTime);
    }

    async getTimer(sessionId) {
        const key = this.TIMER_PREFIX + sessionId;
        const time = await redisClient.get(key);
        return time ? parseInt(time) : null;
    }

    async deleteTimer(sessionId) {
        const key = this.TIMER_PREFIX + sessionId;
        await redisClient.del(key);
    }

    // Adiciona o método que estava faltando
    async removeTimer(sessionId) {
        return this.deleteTimer(sessionId);
    }

    async addToHistory(session) {
        const historyEntry = {
            id: session._id.toString(),
            instanceKey: session.instanceKey,
            startDate: session.configuration.startDate,
            endDate: session.configuration.endDate || new Date(),
            status: session.status,
            interactions: {
                total: session.activities?.length || 0,
                successful: session.activities?.filter(a => a.details?.success)?.length || 0
            },
            methods: session.methods,
            lastAction: new Date(),
            reason: session.status === 'completed' ? 'Concluído' : 
                    session.status === 'paused' ? 'Pausado' : 
                    session.status === 'error' ? 'Erro' : 'Em andamento'
        };

        await redisClient.zadd(
            this.HISTORY_KEY,
            Date.now(),
            JSON.stringify(historyEntry)
        );

        // Mantém apenas as últimas MAX_HISTORY entradas
        const count = await redisClient.zcard(this.HISTORY_KEY);
        if (count > this.MAX_HISTORY) {
            await redisClient.zremrangebyrank(this.HISTORY_KEY, 0, count - this.MAX_HISTORY - 1);
        }
    }

    async getHistory(page = 1, limit = 10) {
        const start = (page - 1) * limit;
        const end = start + limit - 1;

        const entries = await redisClient.zrevrange(this.HISTORY_KEY, start, end, 'WITHSCORES');
        const total = await redisClient.zcard(this.HISTORY_KEY);

        const history = [];
        for (let i = 0; i < entries.length; i += 2) {
            try {
                const entry = JSON.parse(entries[i]);
                const timestamp = parseInt(entries[i + 1]);
                history.push({ ...entry, timestamp });
            } catch (error) {
                console.error('Error parsing history entry:', error);
            }
        }

        return {
            history,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };
    }

    // Novos métodos úteis
    async clearSessionTimers(sessionId) {
        const key = this.TIMER_PREFIX + sessionId;
        await redisClient.del(key);
    }

    async clearAllTimers() {
        const keys = await redisClient.keys(this.TIMER_PREFIX + '*');
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
    }

    async getActiveTimers() {
        const keys = await redisClient.keys(this.TIMER_PREFIX + '*');
        const timers = {};
        
        for (const key of keys) {
            const sessionId = key.replace(this.TIMER_PREFIX, '');
            const time = await this.getTimer(sessionId);
            if (time) {
                timers[sessionId] = time;
            }
        }
        
        return timers;
    }

    async cleanupExpiredTimers() {
        const now = Date.now();
        const timers = await this.getActiveTimers();
        
        for (const [sessionId, time] of Object.entries(timers)) {
            if (time < now) {
                await this.removeTimer(sessionId);
            }
        }
    }
}

module.exports = new RedisTimerService();