/**
 * Agent Runtime Base Class
 * All agents inherit from this class
 */
const feedbackLoop = require('../learning/feedback-loop'); // Add feedback loop

class Agent {
  /**
   * Create a new agent
   * @param {string} name - Agent name
   * @param {Object} config - Agent configuration
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    this.metrics = {
      tasksProcessed: 0,
      successCount: 0,
      failureCount: 0,
      totalExecutionTime: 0
    };
  }

  /**
   * Check if agent can handle a task
   * Override in subclass
   */
  canHandle(task) {
    return false;
  }

  /**
   * Execute a task
   * Override in subclass
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Get agent capabilities
   * Override in subclass
   */
  getCapabilities() {
    return [];
  }

  /**
   * Execute with retry logic
   */
  async executeWithRetry(task, retries = this.config.maxRetries) {
    const startTime = Date.now();
    let interactionId = null;
    
    for (let i = 0; i < retries; i++) {
      try {
        const result = await this.execute(task);
        
        // Update metrics
        this.metrics.tasksProcessed++;
        this.metrics.successCount++;
        this.metrics.totalExecutionTime += Date.now() - startTime;
        
        // Record success in feedback loop
        if (!interactionId) {
          interactionId = await feedbackLoop.record(
            typeof task === 'string' ? task : JSON.stringify(task),
            result,
            { agent: this.name, attempt: i + 1 }
          );
        }
        await feedbackLoop.submitFeedback(interactionId, 'success', 5);
        
        return {
          success: true,
          agent: this.name,
          result,
          attempts: i + 1,
          interactionId
        };
        
      } catch (error) {
        console.log(`${this.name} attempt ${i + 1}/${retries} failed:`, error.message);
        
        // Record failure (but not final if retrying)
        if (i === retries - 1) {
          this.metrics.failureCount++;
          
          // Record final failure
          interactionId = await feedbackLoop.record(
            typeof task === 'string' ? task : JSON.stringify(task),
            error.message,
            { agent: this.name, error: error.message, final: true }
          );
          await feedbackLoop.submitFeedback(interactionId, 'failure', 1);
          
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  /**
   * Record outcome for a completed task (used when executed outside executeWithRetry)
   */
  async recordOutcome(task, result, success = true, metadata = {}) {
    const interactionId = await feedbackLoop.record(
      typeof task === 'string' ? task : JSON.stringify(task),
      result,
      { agent: this.name, ...metadata }
    );
    await feedbackLoop.submitFeedback(
      interactionId,
      success ? 'success' : 'failure',
      success ? 5 : 1
    );
    return interactionId;
  }

  /**
   * Validate task input
   */
  validateTask(task) {
    if (!task || typeof task !== 'string') {
      throw new Error('Task must be a non-empty string');
    }
    return true;
  }

  /**
   * Log agent activity
   */
  log(action, data) {
    console.log(`[${this.name}] ${action}:`, data);
  }

  /**
   * Get agent metrics
   */
  getMetrics() {
    return {
      name: this.name,
      ...this.metrics,
      averageExecutionTime: this.metrics.tasksProcessed > 0 
        ? this.metrics.totalExecutionTime / this.metrics.tasksProcessed 
        : 0
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      tasksProcessed: 0,
      successCount: 0,
      failureCount: 0,
      totalExecutionTime: 0
    };
  }

  /**
   * Initialize agent (called when registered)
   */
  async initialize() {
    console.log(`${this.name} agent initialized`);
    return true;
  }

  /**
   * Cleanup agent resources
   */
  async shutdown() {
    console.log(`${this.name} agent shutting down`);
    return true;
  }
}

module.exports = Agent;
