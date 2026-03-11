/**
 * Node Manager - Cluster controller for distributed workers
 * Manages GPU nodes, load balancing, and health monitoring
 */
const EventEmitter = require('events');
const GPUWorker = require('./gpu-worker');
const TrainingWorker = require('./training-worker');

class NodeManager extends EventEmitter {
  constructor() {
    super();
    
    this.nodes = new Map();
    this.nodeTypes = {
      gpu: GPUWorker,
      training: TrainingWorker
    };
    
    this.loadBalancingStrategy = 'round-robin';
    this.currentIndex = 0;
    this.healthChecks = new Map();
    
    this.initializeDefaultNodes();
  }

  /**
   * Initialize default nodes
   */
  initializeDefaultNodes() {
    // Create 3 GPU nodes
    for (let i = 1; i <= 3; i++) {
      this.addNode('gpu', {
        id: `gpu-node-${i}`,
        name: `GPU Node ${i}`,
        capacity: 100
      });
    }

    // Create 2 training nodes
    for (let i = 1; i <= 2; i++) {
      this.addNode('training', {
        id: `training-node-${i}`,
        name: `Training Node ${i}`,
        capacity: 200
      });
    }

    console.log(`📦 Node manager initialized with ${this.nodes.size} nodes`);
  }

  /**
   * Add a new node to the cluster
   */
  addNode(type, config = {}) {
    const NodeClass = this.nodeTypes[type];
    
    if (!NodeClass) {
      throw new Error(`Unknown node type: ${type}`);
    }

    const node = new NodeClass({
      id: config.id || `${type}-${Date.now()}`,
      ...config
    });

    this.nodes.set(node.id, {
      instance: node,
      type,
      status: 'ready',
      metrics: {
        tasksProcessed: 0,
        successRate: 1.0,
        averageLatency: 0
      },
      addedAt: new Date().toISOString()
    });

    console.log(`✅ Added ${type} node: ${node.id}`);
    this.emit('nodeAdded', { id: node.id, type });

    return node.id;
  }

  /**
   * Remove a node from the cluster
   */
  removeNode(nodeId) {
    if (this.nodes.delete(nodeId)) {
      console.log(`❌ Removed node: ${nodeId}`);
      this.emit('nodeRemoved', { id: nodeId });
      return true;
    }
    return false;
  }

  /**
   * Get next node based on strategy
   */
  next(type = 'gpu') {
    // Filter nodes by type
    const nodes = Array.from(this.nodes.entries())
      .filter(([_, info]) => info.type === type && info.status === 'ready')
      .map(([id, info]) => ({ id, ...info }));

    if (nodes.length === 0) {
      throw new Error(`No available nodes of type: ${type}`);
    }

    switch (this.loadBalancingStrategy) {
      case 'round-robin':
        return this.roundRobin(nodes);
      case 'least-loaded':
        return this.leastLoaded(nodes);
      case 'random':
        return this.random(nodes);
      default:
        return this.roundRobin(nodes);
    }
  }

  /**
   * Round-robin selection
   */
  roundRobin(nodes) {
    const node = nodes[this.currentIndex % nodes.length];
    this.currentIndex = (this.currentIndex + 1) % nodes.length;
    return node;
  }

  /**
   * Least-loaded node selection
   */
  leastLoaded(nodes) {
    return nodes.reduce((best, current) => {
      const bestLoad = best.metrics?.tasksProcessed || 0;
      const currentLoad = current.metrics?.tasksProcessed || 0;
      return currentLoad < bestLoad ? current : best;
    }, nodes[0]);
  }

  /**
   * Random node selection
   */
  random(nodes) {
    const randomIndex = Math.floor(Math.random() * nodes.length);
    return nodes[randomIndex];
  }

  /**
   * Execute task on a node
   */
  async execute(type, task, options = {}) {
    const node = this.next(type);
    
    console.log(`🔄 Executing on ${node.id}: "${task.substring(0, 50)}..."`);

    const startTime = Date.now();

    try {
      let result;

      if (type === 'gpu') {
        result = await node.instance.run(task, options);
      } else if (type === 'training') {
        result = await node.instance.train(task, options);
      }

      const latency = Date.now() - startTime;

      // Update metrics
      node.metrics.tasksProcessed++;
      node.metrics.averageLatency = (node.metrics.averageLatency * (node.metrics.tasksProcessed - 1) + latency) / node.metrics.tasksProcessed;

      this.emit('taskCompleted', {
        nodeId: node.id,
        latency,
        success: true
      });

      return {
        success: true,
        nodeId: node.id,
        result,
        latency
      };

    } catch (error) {
      console.error(`Node ${node.id} execution failed:`, error);

      node.metrics.successRate *= 0.9;

      this.emit('taskFailed', {
        nodeId: node.id,
        error: error.message
      });

      // Try fallback node
      if (options.fallback !== false) {
        console.log('🔄 Trying fallback node...');
        return this.execute(type, task, { ...options, fallback: false });
      }

      return {
        success: false,
        nodeId: node.id,
        error: error.message
      };
    }
  }

  /**
   * Execute task on all nodes (parallel)
   */
  async executeAll(type, task, options = {}) {
    const nodes = Array.from(this.nodes.entries())
      .filter(([_, info]) => info.type === type && info.status === 'ready')
      .map(([id, info]) => info.instance);

    const promises = nodes.map(node =>
      node.run(task, options).catch(error => ({ error: error.message }))
    );

    const results = await Promise.all(promises);

    return {
      success: true,
      nodeCount: nodes.length,
      results
    };
  }

  /**
   * Get node status
   */
  getNodeStatus(nodeId) {
    const node = this.nodes.get(nodeId);
    
    if (!node) return null;

    return {
      id: nodeId,
      type: node.type,
      status: node.status,
      metrics: node.metrics,
      instance: node.instance.getStatus?.() || {}
    };
  }

  /**
   * Get cluster status
   */
  getStatus() {
    const nodes = Array.from(this.nodes.entries()).map(([id, info]) => ({
      id,
      type: info.type,
      status: info.status,
      metrics: info.metrics
    }));

    return {
      totalNodes: this.nodes.size,
      nodesByType: this.getNodeCountByType(),
      strategy: this.loadBalancingStrategy,
      nodes,
      healthChecks: Array.from(this.healthChecks.entries()).map(([id, check]) => ({
        nodeId: id,
        ...check
      }))
    };
  }

  /**
   * Get node count by type
   */
  getNodeCountByType() {
    const counts = {};

    for (const [_, info] of this.nodes) {
      counts[info.type] = (counts[info.type] || 0) + 1;
    }

    return counts;
  }

  /**
   * Set load balancing strategy
   */
  setStrategy(strategy) {
    const valid = ['round-robin', 'least-loaded', 'random'];
    
    if (!valid.includes(strategy)) {
      throw new Error(`Invalid strategy. Choose from: ${valid.join(', ')}`);
    }

    this.loadBalancingStrategy = strategy;
    console.log(`📊 Load balancing strategy set to: ${strategy}`);

    return strategy;
  }

  /**
   * Check node health
   */
  async checkHealth(nodeId) {
    const node = this.nodes.get(nodeId);

    if (!node) return false;

    try {
      // Simple health check - try to execute a tiny task
      if (node.type === 'gpu') {
        await node.instance.run('test', { maxTokens: 1 });
      }

      this.healthChecks.set(nodeId, {
        status: 'healthy',
        lastCheck: new Date().toISOString()
      });

      node.status = 'ready';
      return true;

    } catch (error) {
      this.healthChecks.set(nodeId, {
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        error: error.message
      });

      node.status = 'unhealthy';
      return false;
    }
  }

  /**
   * Check all nodes health
   */
  async checkAllHealth() {
    const promises = [];

    for (const [nodeId] of this.nodes) {
      promises.push(this.checkHealth(nodeId));
    }

    await Promise.all(promises);

    return {
      checked: this.nodes.size,
      healthy: Array.from(this.healthChecks.values()).filter(c => c.status === 'healthy').length
    };
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(interval = 30000) {
    setInterval(() => {
      this.checkAllHealth();
    }, interval);

    console.log(`🩺 Health checks started (interval: ${interval}ms)`);
  }
}

module.exports = new NodeManager();
