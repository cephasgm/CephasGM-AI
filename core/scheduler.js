/**
 * Task Scheduler
 * Routes tasks to appropriate agents with priority and load balancing
 */
class Scheduler {
  constructor() {
    this.queue = [];
    this.running = false;
    this.priorityLevels = ['high', 'normal', 'low'];
    this.agentStats = new Map(); // This must be a Map, not a regular object
  }

  /**
   * Run a task through available agents
   */
  async run(task, agents, options = {}) {
    const {
      priority = 'normal',
      timeout = 30000,
      retry = 0
    } = options;

    if (!task || typeof task !== 'string') {
      throw new Error('Task must be a non-empty string');
    }

    if (!agents || agents.length === 0) {
      throw new Error('No agents available');
    }

    console.log(`🔄 Scheduling task with priority: ${priority}`);

    // Find matching agent
    let selectedAgent = null;
    let bestMatchScore = 0;

    for (const agent of agents) {
      // Check if agent exists and has canHandle method
      if (agent && typeof agent.canHandle === 'function' && agent.canHandle(task)) {
        // Calculate match score (can be enhanced with ML later)
        const score = this.calculateMatchScore(agent, task);
        if (score > bestMatchScore) {
          bestMatchScore = score;
          selectedAgent = agent;
        }
      }
    }

    if (!selectedAgent) {
      // Try to find any agent that has an execute method
      for (const agent of agents) {
        if (agent && typeof agent.execute === 'function') {
          selectedAgent = agent;
          break;
        }
      }
    }

    if (!selectedAgent) {
      throw new Error('No suitable agent found for task');
    }

    // Update stats - FIX: Make sure agentStats is a Map
    this.updateAgentStats(selectedAgent.name || 'unknown');

    // Execute with timeout
    const startTime = Date.now();
    
    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout)
      );
      
      // Race between agent execution and timeout
      const result = await Promise.race([
        Promise.resolve(selectedAgent.execute(task)),
        timeoutPromise
      ]);

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        agent: selectedAgent.name || 'unknown',
        result,
        executionTime,
        priority
      };

    } catch (error) {
      console.error(`Agent ${selectedAgent.name || 'unknown'} failed:`, error);
      
      // Retry logic
      if (retry > 0) {
        console.log(`Retrying task (${retry} attempts left)...`);
        return this.run(task, agents, { ...options, retry: retry - 1 });
      }

      throw error;
    }
  }

  /**
   * Calculate how well an agent matches a task
   */
  calculateMatchScore(agent, task) {
    let score = 0.5; // Base score
    
    const taskLower = task.toLowerCase();
    
    // Check agent capabilities
    if (agent && typeof agent.getCapabilities === 'function') {
      try {
        const capabilities = agent.getCapabilities();
        if (Array.isArray(capabilities)) {
          for (const cap of capabilities) {
            if (taskLower.includes(cap.toLowerCase())) {
              score += 0.2;
            }
          }
        }
      } catch (e) {
        // Ignore capability errors
      }
    }
    
    // Prefer agents with higher success rate - FIX: Check if agentStats is Map
    if (this.agentStats && this.agentStats instanceof Map) {
      const stats = this.agentStats.get(agent.name);
      if (stats && stats.successCount > 0) {
        const successRate = stats.successCount / (stats.successCount + stats.failureCount);
        score += successRate * 0.3;
      }
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Update agent statistics - FIX: Ensure agentStats is a Map
   */
  updateAgentStats(agentName) {
    // Initialize as Map if not already
    if (!(this.agentStats instanceof Map)) {
      this.agentStats = new Map();
    }
    
    if (!this.agentStats.has(agentName)) {
      this.agentStats.set(agentName, {
        tasksAssigned: 0,
        successCount: 0,
        failureCount: 0
      });
    }
    
    const stats = this.agentStats.get(agentName);
    stats.tasksAssigned++;
  }

  /**
   * Record success for an agent
   */
  recordSuccess(agentName) {
    if (!(this.agentStats instanceof Map)) {
      this.agentStats = new Map();
    }
    
    if (!this.agentStats.has(agentName)) {
      this.agentStats.set(agentName, {
        tasksAssigned: 0,
        successCount: 0,
        failureCount: 0
      });
    }
    
    const stats = this.agentStats.get(agentName);
    stats.successCount++;
  }

  /**
   * Record failure for an agent
   */
  recordFailure(agentName) {
    if (!(this.agentStats instanceof Map)) {
      this.agentStats = new Map();
    }
    
    if (!this.agentStats.has(agentName)) {
      this.agentStats.set(agentName, {
        tasksAssigned: 0,
        successCount: 0,
        failureCount: 0
      });
    }
    
    const stats = this.agentStats.get(agentName);
    stats.failureCount++;
  }

  /**
   * Add task to queue for later processing
   */
  queueTask(task, agents, options = {}) {
    const queueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      task,
      agents,
      options,
      queuedAt: Date.now()
    };
    
    this.queue.push(queueItem);
    
    // Process queue if not already running
    if (!this.running) {
      // Use setTimeout to avoid blocking
      setTimeout(() => this.processQueue(), 0);
    }
    
    return queueItem.id;
  }

  /**
   * Process queued tasks
   */
  async processQueue() {
    if (this.running || this.queue.length === 0) return;
    
    this.running = true;
    
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      try {
        await this.run(item.task, item.agents, item.options);
      } catch (error) {
        console.error('Queue task failed:', error);
      }
      // Small delay between queue items
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.running = false;
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    // Safely convert Map to object
    const statsObj = {};
    if (this.agentStats instanceof Map) {
      for (const [key, value] of this.agentStats.entries()) {
        statsObj[key] = value;
      }
    }
    
    return {
      queueLength: this.queue.length,
      running: this.running,
      agentStats: statsObj
    };
  }

  /**
   * Clear task queue
   */
  clearQueue() {
    this.queue = [];
    console.log('Task queue cleared');
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.agentStats = new Map();
    console.log('Agent statistics reset');
  }
}

// Export as singleton
module.exports = new Scheduler();
