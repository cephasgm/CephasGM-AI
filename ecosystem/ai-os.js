/**
 * AI Operating System - Core of the AI Ecosystem
 * Manages agents, resources, and system-wide operations
 */
const EventEmitter = require('events');
const factory = require("./agent-factory");
const cluster = require("../cluster/node-manager");
const vectorDb = require("../memory/vector-db");
const knowledgeGraph = require("../memory/knowledge-graph");

class AIOS extends EventEmitter {
  constructor() {
    super();
    
    this.agents = new Map();
    this.runtime = {
      status: 'initializing',
      startTime: Date.now(),
      tasksProcessed: 0,
      activeAgents: 0
    };
    
    this.metrics = {
      tasksByType: {},
      agentPerformance: {},
      systemLoad: []
    };
    
    console.log('🧠 AIOS initializing...');
    this.initialize();
  }

  /**
   * Initialize the AIOS
   */
  async initialize() {
    // Create default agents
    this.createAgent('research');
    this.createAgent('software');
    this.createAgent('autonomous');
    
    this.runtime.status = 'ready';
    this.emit('ready', { timestamp: Date.now() });
    
    console.log(`✅ AIOS ready with ${this.agents.size} agents`);
  }

  /**
   * Create a new agent
   */
  createAgent(type, config = {}) {
    try {
      const agent = factory.build(type, config);
      
      if (!agent) {
        throw new Error(`Failed to create agent of type: ${type}`);
      }

      const agentId = this.generateAgentId();
      agent.id = agentId;
      agent.createdAt = new Date().toISOString();
      
      this.agents.set(agentId, agent);
      this.runtime.activeAgents++;
      
      console.log(`🤖 Created agent [${agentId}]: ${type}`);
      this.emit('agentCreated', { agentId, type });

      return {
        id: agentId,
        type,
        ...agent.getInfo?.() || { status: 'active' }
      };

    } catch (error) {
      console.error(`Failed to create agent ${type}:`, error);
      throw error;
    }
  }

  /**
   * Destroy an agent
   */
  destroyAgent(agentId) {
    if (this.agents.delete(agentId)) {
      this.runtime.activeAgents--;
      console.log(`💀 Destroyed agent: ${agentId}`);
      this.emit('agentDestroyed', { agentId });
      return true;
    }
    return false;
  }

  /**
   * Run a task through available agents
   */
  async runTask(task, options = {}) {
    const taskId = this.generateTaskId();
    const startTime = Date.now();

    console.log(`\n📋 [${taskId}] Processing task: "${task.substring(0, 50)}..."`);

    if (!task || typeof task !== 'string') {
      throw new Error('Task must be a non-empty string');
    }

    try {
      // Find suitable agent
      let selectedAgent = null;
      let bestMatchScore = 0;

      for (const [agentId, agent] of this.agents) {
        if (agent.canHandle && agent.canHandle(task)) {
          const score = this.calculateMatchScore(agent, task);
          if (score > bestMatchScore) {
            bestMatchScore = score;
            selectedAgent = { id: agentId, ...agent };
          }
        }
      }

      if (!selectedAgent) {
        // Try autonomous agent as fallback
        for (const [agentId, agent] of this.agents) {
          if (agent.constructor.name === 'AutonomousAgent') {
            selectedAgent = { id: agentId, ...agent };
            break;
          }
        }
      }

      if (!selectedAgent) {
        throw new Error('No suitable agent available');
      }

      // Execute task
      console.log(`🤖 Using agent: ${selectedAgent.constructor.name} (${selectedAgent.id})`);

      const result = await selectedAgent.execute(task, options);

      const executionTime = Date.now() - startTime;

      // Update metrics
      this.runtime.tasksProcessed++;
      this.metrics.tasksByType[selectedAgent.constructor.name] = 
        (this.metrics.tasksByType[selectedAgent.constructor.name] || 0) + 1;

      // Store in vector memory if significant
      if (result && result.length > 100) {
        await vectorDb.add({
          id: taskId,
          vector: this.textToVector(task),
          metadata: {
            task,
            result: result.substring(0, 200),
            agent: selectedAgent.constructor.name,
            timestamp: Date.now()
          }
        });
      }

      // Emit completion
      this.emit('taskCompleted', {
        taskId,
        agentId: selectedAgent.id,
        executionTime,
        success: true
      });

      return {
        success: true,
        taskId,
        agent: selectedAgent.constructor.name,
        result,
        executionTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ [${taskId}] Task failed:`, error);

      this.emit('taskFailed', {
        taskId,
        error: error.message
      });

      return {
        success: false,
        taskId,
        error: error.message,
        task
      };
    }
  }

  /**
   * Run multiple tasks in parallel
   */
  async runTasks(tasks, options = {}) {
    const promises = tasks.map(task => this.runTask(task, options));
    return Promise.all(promises);
  }

  /**
   * Calculate match score between agent and task
   */
  calculateMatchScore(agent, task) {
    let score = 0.5;
    
    const taskLower = task.toLowerCase();
    
    // Check agent name
    const agentName = agent.constructor.name.toLowerCase();
    if (taskLower.includes(agentName.replace('agent', ''))) {
      score += 0.3;
    }

    // Check capabilities
    if (agent.getCapabilities) {
      const capabilities = agent.getCapabilities();
      for (const cap of capabilities) {
        if (taskLower.includes(cap.toLowerCase())) {
          score += 0.2;
        }
      }
    }

    return Math.min(score, 1.0);
  }

  /**
   * Convert text to simple vector (for demo)
   */
  textToVector(text) {
    const words = text.toLowerCase().split(/\s+/);
    const vector = new Array(10).fill(0);
    
    words.forEach((word, idx) => {
      const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      vector[idx % 10] += hash / 1000;
    });
    
    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      status: this.runtime.status,
      uptime: Date.now() - this.runtime.startTime,
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        type: agent.constructor.name,
        createdAt: agent.createdAt
      })),
      metrics: {
        tasksProcessed: this.runtime.tasksProcessed,
        activeAgents: this.runtime.activeAgents,
        ...this.metrics
      },
      cluster: cluster.getStatus?.() || { workers: ['node1', 'node2', 'node3'] }
    };
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * List all agents
   */
  listAgents() {
    return Array.from(this.agents.entries()).map(([id, agent]) => ({
      id,
      type: agent.constructor.name,
      capabilities: agent.getCapabilities?.() || [],
      createdAt: agent.createdAt
    }));
  }

  /**
   * Generate agent ID
   */
  generateAgentId() {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown AIOS
   */
  async shutdown() {
    console.log('🛑 Shutting down AIOS...');
    this.runtime.status = 'shutting_down';
    
    // Destroy all agents
    for (const [agentId] of this.agents) {
      this.destroyAgent(agentId);
    }
    
    this.runtime.status = 'stopped';
    this.emit('shutdown', { timestamp: Date.now() });
    
    console.log('👋 AIOS stopped');
  }
}

module.exports = new AIOS();
