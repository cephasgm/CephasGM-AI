/**
 * Cluster Scheduler
 * Manages worker nodes and distributes tasks across the cluster
 */
const EventEmitter = require('events');
const WorkerNode = require('./worker-node');

class ClusterScheduler extends EventEmitter {
  constructor() {
    super();
    
    this.workers = [];
    this.workerMap = new Map();
    this.currentIndex = 0;
    this.strategies = ['round-robin', 'least-loaded', 'random', 'weighted'];
    this.strategy = 'round-robin';
    
    this.metrics = {
      totalTasksScheduled: 0,
      tasksByWorker: {},
      averageQueueTime: 0,
      workerHealth: {}
    };

    // Initialize with default workers
    this.addWorker('worker-1');
    this.addWorker('worker-2');
    this.addWorker('worker-3');

    // Start health checks
    this.startHealthChecks();
  }

  /**
   * Add a worker to the cluster
   */
  addWorker(workerId) {
    let worker;

    if (typeof workerId === 'string') {
      worker = new WorkerNode(workerId);
    } else {
      worker = workerId;
    }

    this.workers.push(worker);
    this.workerMap.set(worker.id, worker);
    this.metrics.tasksByWorker[worker.id] = 0;

    worker.on('taskCompleted', (data) => {
      this.emit('taskCompleted', { workerId: worker.id, ...data });
    });

    worker.on('taskFailed', (data) => {
      this.emit('taskFailed', { workerId: worker.id, ...data });
    });

    console.log(`➕ Worker added to cluster: ${worker.id}. Total workers: ${this.workers.length}`);

    return worker.id;
  }

  /**
   * Remove a worker from the cluster
   */
  removeWorker(workerId) {
    const initialLength = this.workers.length;
    this.workers = this.workers.filter(w => w.id !== workerId);
    this.workerMap.delete(workerId);
    
    if (this.workers.length < initialLength) {
      console.log(`➖ Worker removed from cluster: ${workerId}. Total workers: ${this.workers.length}`);
      this.emit('workerRemoved', workerId);
    }

    return this.workers.length;
  }

  /**
   * Get next worker based on strategy
   */
  nextWorker(task = null) {
    if (this.workers.length === 0) {
      throw new Error('No workers available in cluster');
    }

    let worker;

    switch (this.strategy) {
      case 'round-robin':
        worker = this.roundRobin();
        break;

      case 'least-loaded':
        worker = this.leastLoaded();
        break;

      case 'random':
        worker = this.random();
        break;

      case 'weighted':
        worker = this.weighted(task);
        break;

      default:
        worker = this.roundRobin();
    }

    // Update metrics
    this.metrics.totalTasksScheduled++;
    this.metrics.tasksByWorker[worker.id] = (this.metrics.tasksByWorker[worker.id] || 0) + 1;

    return worker.id;
  }

  /**
   * Round-robin selection
   */
  roundRobin() {
    const worker = this.workers[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.workers.length;
    return worker;
  }

  /**
   * Least-loaded worker selection
   */
  leastLoaded() {
    let bestWorker = this.workers[0];
    let lowestLoad = Infinity;

    for (const worker of this.workers) {
      const status = worker.getStatus();
      const load = status.metrics.tasksProcessed - (status.metrics.failedTasks || 0);
      
      if (load < lowestLoad) {
        lowestLoad = load;
        bestWorker = worker;
      }
    }

    return bestWorker;
  }

  /**
   * Random worker selection
   */
  random() {
    const randomIndex = Math.floor(Math.random() * this.workers.length);
    return this.workers[randomIndex];
  }

  /**
   * Weighted selection based on task type
   */
  weighted(task) {
    if (!task) return this.roundRobin();

    // Prefer workers with relevant models
    for (const worker of this.workers) {
      if (task.model && worker.hasModel && worker.hasModel(task.model)) {
        return worker;
      }
    }

    return this.leastLoaded();
  }

  /**
   * Schedule a task on a worker
   */
  async schedule(task, options = {}) {
    const workerId = this.nextWorker(task);
    const worker = this.workerMap.get(workerId);

    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    console.log(`📋 Scheduling task on worker: ${workerId}`);

    try {
      const result = await worker.run(task.prompt, options);
      
      return {
        ...result,
        workerId,
        scheduled: true
      };

    } catch (error) {
      console.error(`Task failed on worker ${workerId}:`, error);

      // Try fallback worker
      if (options.fallback !== false) {
        console.log('🔄 Trying fallback worker...');
        const fallbackWorker = this.getNextAvailable(workerId);
        
        if (fallbackWorker) {
          return fallbackWorker.run(task.prompt, options);
        }
      }

      throw error;
    }
  }

  /**
   * Schedule a batch of tasks
   */
  async scheduleBatch(tasks, options = {}) {
    const results = await Promise.all(
      tasks.map(task => this.schedule(task, options).catch(error => ({
        success: false,
        error: error.message,
        task
      })))
    );

    return {
      success: true,
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Get next available worker (excluding specified)
   */
  getNextAvailable(excludeWorkerId) {
    const available = this.workers.filter(w => w.id !== excludeWorkerId);
    
    if (available.length === 0) {
      return null;
    }

    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Start health checks
   */
  startHealthChecks(interval = 30000) {
    setInterval(() => {
      this.checkHealth();
    }, interval);
  }

  /**
   * Check health of all workers
   */
  async checkHealth() {
    for (const worker of this.workers) {
      try {
        const status = worker.getStatus();
        this.metrics.workerHealth[worker.id] = {
          status: 'healthy',
          timestamp: Date.now(),
          ...status
        };
      } catch (error) {
        this.metrics.workerHealth[worker.id] = {
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message
        };
      }
    }
  }

  /**
   * Get cluster status
   */
  getStatus() {
    return {
      strategy: this.strategy,
      workerCount: this.workers.length,
      workers: this.workers.map(w => w.getStatus()),
      metrics: {
        ...this.metrics,
        averageTasksPerWorker: this.workers.length > 0 
          ? this.metrics.totalTasksScheduled / this.workers.length 
          : 0
      },
      health: this.metrics.workerHealth
    };
  }

  /**
   * Set scheduling strategy
   */
  setStrategy(strategy) {
    if (!this.strategies.includes(strategy)) {
      throw new Error(`Invalid strategy. Choose from: ${this.strategies.join(', ')}`);
    }

    this.strategy = strategy;
    console.log(`📊 Scheduling strategy set to: ${strategy}`);

    return this.strategy;
  }

  /**
   * Get available strategies
   */
  getStrategies() {
    return this.strategies;
  }

  /**
   * Get worker by ID
   */
  getWorker(workerId) {
    return this.workerMap.get(workerId);
  }

  /**
   * Get all workers
   */
  getAllWorkers() {
    return this.workers.map(w => w.getStatus());
  }

  /**
   * Shutdown cluster
   */
  async shutdown() {
    console.log('🛑 Shutting down cluster...');

    const promises = this.workers.map(w => w.shutdown());
    await Promise.all(promises);

    this.workers = [];
    this.workerMap.clear();

    console.log('👋 Cluster stopped');

    return {
      success: true
    };
  }
}

module.exports = new ClusterScheduler();
