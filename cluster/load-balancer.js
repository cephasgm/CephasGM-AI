/**
 * Load Balancer - Distribute tasks across GPU nodes
 */
const GPUNode = require("./gpu-node");
const EventEmitter = require("events");

class LoadBalancer extends EventEmitter {
  constructor() {
    super();
    
    this.nodes = [];
    this.currentIndex = 0;
    this.strategies = ['round-robin', 'least-loaded', 'random'];
    this.strategy = 'round-robin';
    this.healthChecks = new Map();
    
    // Start with some default nodes
    this.addNode(new GPUNode('gpu-node-1'));
    this.addNode(new GPUNode('gpu-node-2'));
    
    // Start health checks
    this.startHealthChecks();
  }

  /**
   * Add a node to the cluster
   */
  addNode(node) {
    this.nodes.push(node);
    
    node.on('ready', (id) => {
      console.log(`✅ Node ready for load balancing: ${id}`);
      this.emit('nodeReady', id);
    });
    
    node.on('shutdown', (id) => {
      console.log(`❌ Node removed from load balancer: ${id}`);
      this.emit('nodeShutdown', id);
    });
    
    console.log(`📦 Added node to cluster: ${node.id}. Total nodes: ${this.nodes.length}`);
    
    return this.nodes.length;
  }

  /**
   * Remove a node from the cluster
   */
  removeNode(nodeId) {
    const initialLength = this.nodes.length;
    this.nodes = this.nodes.filter(node => node.id !== nodeId);
    
    if (this.nodes.length < initialLength) {
      console.log(`📦 Removed node ${nodeId}. Total nodes: ${this.nodes.length}`);
      this.emit('nodeRemoved', nodeId);
    }
    
    return this.nodes.length;
  }

  /**
   * Get next node based on strategy
   */
  getNextNode(task) {
    if (this.nodes.length === 0) {
      throw new Error('No nodes available in cluster');
    }

    switch (this.strategy) {
      case 'round-robin':
        return this.roundRobin();
        
      case 'least-loaded':
        return this.leastLoaded();
        
      case 'random':
        return this.random();
        
      default:
        return this.roundRobin();
    }
  }

  /**
   * Round-robin selection
   */
  roundRobin() {
    const node = this.nodes[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
    return node;
  }

  /**
   * Least-loaded node selection
   */
  leastLoaded() {
    let bestNode = this.nodes[0];
    let lowestLoad = Infinity;
    
    for (const node of this.nodes) {
      const load = node.metrics?.tasksProcessed || 0;
      if (load < lowestLoad) {
        lowestLoad = load;
        bestNode = node;
      }
    }
    
    return bestNode;
  }

  /**
   * Random node selection
   */
  random() {
    const randomIndex = Math.floor(Math.random() * this.nodes.length);
    return this.nodes[randomIndex];
  }

  /**
   * Execute task on selected node
   */
  async execute(task, model = 'llama3', options = {}) {
    try {
      const node = this.getNextNode(task);
      
      console.log(`🔄 Load balancer routing task to ${node.id}`);
      
      const result = await node.run(task, model, options);
      
      return {
        ...result,
        strategy: this.strategy,
        nodeCount: this.nodes.length
      };
      
    } catch (error) {
      console.error('Load balancer execution failed:', error);
      
      // Try fallback to another node
      if (this.nodes.length > 1) {
        console.log('⚠️ Trying fallback node...');
        const fallbackNode = this.nodes.find(n => n.id !== error.nodeId);
        if (fallbackNode) {
          return fallbackNode.run(task, model, options);
        }
      }
      
      throw error;
    }
  }

  /**
   * Execute task on all nodes (parallel)
   */
  async executeParallel(task, model = 'llama3', options = {}) {
    const promises = this.nodes.map(node => 
      node.run(task, model, options).catch(error => ({
        success: false,
        nodeId: node.id,
        error: error.message
      }))
    );
    
    const results = await Promise.all(promises);
    
    return {
      success: true,
      results,
      nodeCount: this.nodes.length
    };
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
   * Check health of all nodes
   */
  async checkHealth() {
    for (const node of this.nodes) {
      try {
        const status = node.getStatus();
        this.healthChecks.set(node.id, {
          status: 'healthy',
          timestamp: Date.now(),
          ...status
        });
      } catch (error) {
        console.warn(`Health check failed for ${node.id}:`, error.message);
        this.healthChecks.set(node.id, {
          status: 'unhealthy',
          timestamp: Date.now(),
          error: error.message
        });
      }
    }
  }

  /**
   * Get cluster status
   */
  getStatus() {
    return {
      strategy: this.strategy,
      nodeCount: this.nodes.length,
      nodes: this.nodes.map(node => node.getStatus()),
      healthChecks: Object.fromEntries(this.healthChecks),
      currentIndex: this.currentIndex
    };
  }

  /**
   * Set load balancing strategy
   */
  setStrategy(strategy) {
    if (!this.strategies.includes(strategy)) {
      throw new Error(`Invalid strategy. Choose from: ${this.strategies.join(', ')}`);
    }
    
    this.strategy = strategy;
    console.log(`📊 Load balancing strategy set to: ${strategy}`);
    
    return this.strategy;
  }

  /**
   * Get available strategies
   */
  getStrategies() {
    return this.strategies;
  }

  /**
   * Shutdown all nodes
   */
  async shutdown() {
    console.log('🛑 Shutting down all nodes...');
    
    const promises = this.nodes.map(node => node.shutdown());
    await Promise.all(promises);
    
    this.nodes = [];
    this.healthChecks.clear();
    
    console.log('👋 Load balancer stopped');
    
    return {
      success: true
    };
  }
}

module.exports = new LoadBalancer();
