/**
 * AI Operating System Core
 * Manages agents, scheduling, and system-wide operations
 */
const scheduler = require("./scheduler");
const EventEmitter = require('events');

class CephasOS extends EventEmitter {
  constructor() {
    super();
    this.agents = new Map();
    this.tasks = [];
    this.status = 'initializing';
    this.metrics = {
      tasksProcessed: 0,
      agentsUsed: {},
      startTime: Date.now()
    };
    
    console.log('🧠 CephasOS initializing...');
    this.status = 'ready';
    this.emit('ready');
  }

  /**
   * Register an agent with the OS
   */
  registerAgent(agent) {
    if (!agent || !agent.name) {
      throw new Error('Agent must have a name');
    }
    
    this.agents.set(agent.name, agent);
    this.metrics.agentsUsed[agent.name] = 0;
    
    console.log(`✅ Agent registered: ${agent.name}`);
    this.emit('agentRegistered', agent);
    
    return this;
  }

  /**
   * Register multiple agents at once
   */
  registerAgents(agentsArray) {
    agentsArray.forEach(agent => this.registerAgent(agent));
    return this;
  }

  /**
   * Execute a task using the scheduler
   */
  async execute(task, options = {}) {
    const taskId = this.generateTaskId();
    const startTime = Date.now();
    
    console.log(`\n📋 [${taskId}] Executing task: "${task.substring(0, 50)}..."`);
    
    const taskRecord = {
      id: taskId,
      task,
      options,
      startTime,
      status: 'pending'
    };
    
    this.tasks.push(taskRecord);
    this.emit('taskStarted', taskRecord);

    try {
      // Run through scheduler
      const result = await scheduler.run(task, Array.from(this.agents.values()), options);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Update metrics
      this.metrics.tasksProcessed++;
      if (result.agent) {
        this.metrics.agentsUsed[result.agent] = (this.metrics.agentsUsed[result.agent] || 0) + 1;
      }
      
      taskRecord.status = 'completed';
      taskRecord.result = result;
      taskRecord.executionTime = executionTime;
      
      console.log(`✅ [${taskId}] Task completed in ${executionTime}ms by ${result.agent || 'unknown'}`);
      this.emit('taskCompleted', taskRecord);
      
      return {
        success: true,
        taskId,
        ...result,
        executionTime
      };
      
    } catch (error) {
      console.error(`❌ [${taskId}] Task failed:`, error);
      
      taskRecord.status = 'failed';
      taskRecord.error = error.message;
      
      this.emit('taskFailed', taskRecord);
      
      return {
        success: false,
        taskId,
        error: error.message,
        task
      };
    }
  }

  /**
   * Execute multiple tasks in parallel
   */
  async executeParallel(tasks, options = {}) {
    const promises = tasks.map(task => this.execute(task, options));
    return Promise.all(promises);
  }

  /**
   * Execute tasks in sequence
   */
  async executeSequence(tasks, options = {}) {
    const results = [];
    for (const task of tasks) {
      results.push(await this.execute(task, options));
    }
    return results;
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      status: this.status,
      uptime: Date.now() - this.metrics.startTime,
      agents: Array.from(this.agents.keys()),
      metrics: this.metrics,
      queueLength: this.tasks.filter(t => t.status === 'pending').length
    };
  }

  /**
   * Get an agent by name
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * List all registered agents
   */
  listAgents() {
    return Array.from(this.agents.values()).map(agent => ({
      name: agent.name,
      capabilities: agent.getCapabilities ? agent.getCapabilities() : ['unknown']
    }));
  }

  /**
   * Remove an agent
   */
  unregisterAgent(name) {
    if (this.agents.delete(name)) {
      console.log(`❌ Agent unregistered: ${name}`);
      this.emit('agentUnregistered', name);
      return true;
    }
    return false;
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown the OS gracefully
   */
  async shutdown() {
    console.log('🛑 Shutting down CephasOS...');
    this.status = 'shutting_down';
    this.emit('shutdown');
    
    // Wait for pending tasks?
    const pending = this.tasks.filter(t => t.status === 'pending');
    if (pending.length > 0) {
      console.log(`Waiting for ${pending.length} pending tasks...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    this.status = 'stopped';
    console.log('👋 CephasOS stopped');
  }
}

module.exports = new CephasOS();
