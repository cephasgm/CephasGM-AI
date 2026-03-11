/**
 * Task Scheduler
 * Routes tasks to appropriate agents with priority and load balancing
 */
class Scheduler {
  constructor() {
    this.queue = [];
    this.running = false;
    this.priorityLevels = ['high', 'normal', 'low'];
    this.agentStats = new Map();
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
      if (agent.canHandle && agent.canHandle(task)) {
        // Calculate match score (can be enhanced with ML later)
        const score = this.calculateMatchScore(agent, task);
        if (score > bestMatchScore) {
          bestMatchScore = score;
          selectedAgent = agent;
        }
      }
    }

    if (!selectedAgent) {
      // Try to find any agent that might handle it
      for (const agent of agents) {
        if (agent.execute) {
          selectedAgent = agent;
          break;
        }
      }
    }

    if (!selectedAgent) {
      throw new Error('No suitable agent found for task');
    }

    // Update stats
    this.updateAgentStats(selectedAgent.name);

    // Execute with timeout
    const startTime = Date.now();
    
    try {
      const result = await Promise.race([
        selectedAgent.execute(task),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Task timeout after ${timeout}ms`)), timeout)
        )
      ]);

      const executionTime = Date.now() - startTime;

      return {
        success: true,
        agent: selectedAgent.name,
        result,
        executionTime,
        priority
      };

    } catch (error) {
      console.error(`Agent ${selectedAgent.name} failed:`, error);
      
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
    if (agent.getCapabilities) {
      const capabilities = agent.getCapabilities();
      for (const cap of capabilities) {
        if (taskLower.includes(cap.toLowerCase())) {
          score += 0.2;
        }
      }
    }
    
    // Prefer agents with higher success rate
    const stats = this.agentStats.get(agent.name);
    if (stats && stats.successCount > 0) {
      const successRate = stats.successCount / (stats.successCount + stats.failureCount);
      score += successRate * 0.3;
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Update agent statistics
   */
  updateAgentStats(agentName) {
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
    
    if (!this.running) {
      this.processQueue();
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
    }
    
    this.running = false;
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      running: this.running,
      agentStats: Object.fromEntries(this.agentStats)
    };
  }

  /**
   * Clear task queue
   */
  clearQueue() {
    this.queue = [];
    console.log('Task queue cleared');
  }
}

module.exports = new Scheduler();
