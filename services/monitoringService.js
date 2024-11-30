const redisClient = require('../config/redisConfig');
const { EventEmitter } = require('events');

class MonitoringService extends EventEmitter {
    constructor() {
        super();
        this.healthCheckInterval = 30000; // 30 seconds
        this.metrics = {
            totalRequests: 0,
            failedRequests: 0,
            activeInstances: new Set()
        };
    }

    start() {
        // Monitor system health
        setInterval(async () => {
            await this.checkSystemHealth();
        }, this.healthCheckInterval);
    }

    async checkSystemHealth() {
        try {
            const instances = await this.getActiveInstances();
            
            for (const instance of instances) {
                const healthKey = `health:${instance}`;
                const errorKey = `errors:${instance}`;
                
                const [health, errors] = await Promise.all([
                    redisClient.get(healthKey),
                    redisClient.get(errorKey)
                ]);

                if (health !== 'ok' || (errors && parseInt(errors) > 5)) {
                    this.emit('instanceUnhealthy', {
                        instance,
                        health,
                        errors: parseInt(errors) || 0
                    });
                }
            }
        } catch (error) {
            console.error('Health check failed:', error);
        }
    }

    async getActiveInstances() {
        // Implement logic to get active instances from Redis
        const instances = Array.from(this.metrics.activeInstances);
        return instances;
    }

    recordRequest(instanceKey, success = true) {
        this.metrics.totalRequests++;
        if (!success) {
            this.metrics.failedRequests++;
        }
        this.metrics.activeInstances.add(instanceKey);
    }

    getMetrics() {
        return {
            ...this.metrics,
            activeInstances: Array.from(this.metrics.activeInstances),
            errorRate: (this.metrics.failedRequests / this.metrics.totalRequests) || 0
        };
    }
}

const monitoringService = new MonitoringService();
module.exports = monitoringService;
