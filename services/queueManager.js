const EventEmitter = require('events');

class QueueManager extends EventEmitter {
    constructor() {
        super();
        this.queues = new Map();
        this.stats = {
            totalProcessed: 0,
            currentLoad: 0,
            peakLoad: 0,
            errors: 0
        };
        //
        // Configurações
        this.config = {
            maxGlobalConcurrent: 400000,
            maxInstanceConcurrent: 100,
            queueTimeout: 30000, // 30 segundos
            retryAttempts: 3,
            retryDelay: 1000
        };

        // Métricas em tempo real
        setInterval(() => this.updateMetrics(), 5000);
    }

    async updateMetrics() {
        const metrics = {
            timestamp: Date.now(),
            activeQueues: this.queues.size,
            totalProcessed: this.stats.totalProcessed,
            currentLoad: this.stats.currentLoad,
            peakLoad: this.stats.peakLoad,
            errorRate: (this.stats.errors / this.stats.totalProcessed) || 0,
            queueSizes: {}
        };

        this.queues.forEach((queue, instanceKey) => {
            metrics.queueSizes[instanceKey] = queue.pending.length;
        });

        this.emit('metrics', metrics);
    }

    getInstanceQueue(instanceKey) {
        if (!this.queues.has(instanceKey)) {
            this.queues.set(instanceKey, {
                pending: [],
                processing: 0,
                lastProcessed: Date.now(),
                metrics: {
                    processed: 0,
                    errors: 0,
                    avgProcessingTime: 0
                }
            });
        }
        return this.queues.get(instanceKey);
    }

    async enqueue(instanceKey, task) {
        const queue = this.getInstanceQueue(instanceKey);
        
        // Criar objeto de tarefa com metadata
        const taskWrapper = {
            id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            instanceKey,
            task,
            addedAt: Date.now(),
            attempts: 0,
            status: 'pending'
        };

        queue.pending.push(taskWrapper);
        
        this.emit('taskAdded', {
            instanceKey,
            taskId: taskWrapper.id,
            queueSize: queue.pending.length
        });

        // Tentar processar a fila
        this.processQueue(instanceKey);
        
        return taskWrapper.id;
    }

    async processQueue(instanceKey) {
        const queue = this.getInstanceQueue(instanceKey);
        
        // Verificar limites
        if (queue.processing >= this.config.maxInstanceConcurrent || 
            this.stats.currentLoad >= this.config.maxGlobalConcurrent) {
            return;
        }

        // Pegar próxima tarefa
        const taskWrapper = queue.pending.shift();
        if (!taskWrapper) return;

        try {
            // Atualizar contadores
            queue.processing++;
            this.stats.currentLoad++;
            this.stats.peakLoad = Math.max(this.stats.peakLoad, this.stats.currentLoad);
            
            taskWrapper.status = 'processing';
            taskWrapper.startedAt = Date.now();

            // Emitir evento de início
            this.emit('taskStarted', {
                instanceKey,
                taskId: taskWrapper.id,
                attempt: taskWrapper.attempts + 1
            });

            // Executar tarefa
            await this.executeWithRetry(taskWrapper);

            // Atualizar métricas
            queue.metrics.processed++;
            this.stats.totalProcessed++;
            
            // Calcular tempo de processamento
            const processingTime = Date.now() - taskWrapper.startedAt;
            queue.metrics.avgProcessingTime = 
                (queue.metrics.avgProcessingTime * (queue.metrics.processed - 1) + processingTime) / 
                queue.metrics.processed;

            this.emit('taskCompleted', {
                instanceKey,
                taskId: taskWrapper.id,
                processingTime
            });

        } catch (error) {
            queue.metrics.errors++;
            this.stats.errors++;
            
            this.emit('taskError', {
                instanceKey,
                taskId: taskWrapper.id,
                error: error.message,
                attempt: taskWrapper.attempts
            });

        } finally {
            // Limpar contadores
            queue.processing--;
            this.stats.currentLoad--;
            queue.lastProcessed = Date.now();

            // Continuar processando a fila
            if (queue.pending.length > 0) {
                setImmediate(() => this.processQueue(instanceKey));
            }
        }
    }

    async executeWithRetry(taskWrapper) {
        for (let i = 0; i < this.config.retryAttempts; i++) {
            try {
                taskWrapper.attempts++;
                await taskWrapper.task();
                return;
            } catch (error) {
                if (i === this.config.retryAttempts - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * Math.pow(2, i)));
            }
        }
    }

    getQueueStatus(instanceKey) {
        const queue = this.getInstanceQueue(instanceKey);
        return {
            pending: queue.pending.length,
            processing: queue.processing,
            metrics: queue.metrics,
            lastProcessed: queue.lastProcessed
        };
    }

    getGlobalStatus() {
        return {
            activeQueues: this.queues.size,
            currentLoad: this.stats.currentLoad,
            peakLoad: this.stats.peakLoad,
            totalProcessed: this.stats.totalProcessed,
            errorRate: (this.stats.errors / this.stats.totalProcessed) || 0,
            queues: Array.from(this.queues.entries()).map(([key, queue]) => ({
                instanceKey: key,
                ...this.getQueueStatus(key)
            }))
        };
    }
}

// Criar instância global
const queueManager = new QueueManager();

// Exemplo de uso:
queueManager.on('metrics', (metrics) => {
   // console.log(`[QueueManager] Métricas atualizadas:`, metrics);
});

queueManager.on('taskError', (error) => {
    console.error(`[QueueManager] Erro na tarefa:`, error);
});

module.exports = queueManager;