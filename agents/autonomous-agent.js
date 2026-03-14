/**
 * Autonomous Agent - Self-learning, adaptable agent
 * Can handle general tasks and learn from interactions
 * Integrated with feedback loop for learning
 */
const EventEmitter = require('events');
const fetch = require('node-fetch');
const vm = require('vm');
const feedbackLoop = require('../learning/feedback-loop'); // Added for feedback recording

class AutonomousAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.id = config.id || `auto_${Date.now()}`;
    this.type = 'autonomous';
    this.config = {
      learningRate: config.learningRate || 0.1,
      adaptability: config.adaptability || 0.5,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000,
      ...config
    };
    
    this.memory = [];
    this.learnedPatterns = new Map();
    this.successRate = 1.0;
    this.tasksProcessed = 0;
    
    this.capabilities = [
      'general', 'process', 'analyze', 'generate',
      'summarize', 'translate', 'reason', 'plan'
    ];
    
    console.log(`🤖 AutonomousAgent [${this.id}] initialized`);
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    // Autonomous agent can handle any task as fallback
    return true;
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return this.capabilities;
  }

  /**
   * Execute a task with feedback recording
   */
  async execute(task, options = {}) {
    const startTime = Date.now();
    const taskId = `task_${Date.now()}`;
    let interactionId;

    console.log(`🔄 Autonomous agent processing: "${task.substring(0, 50)}..."`);

    try {
      // Check if similar task was learned
      const learned = this.recall(task);
      if (learned && options.useLearning !== false) {
        console.log('📚 Using learned pattern');
        return learned;
      }

      // Determine task type
      let result;

      if (task.toLowerCase().includes('analyze') || task.toLowerCase().includes('examine')) {
        result = await this.analyze(task);
      } else if (task.toLowerCase().includes('generate') || task.toLowerCase().includes('create')) {
        result = await this.generate(task);
      } else if (task.toLowerCase().includes('summarize')) {
        result = await this.summarize(task);
      } else if (task.toLowerCase().includes('translate')) {
        result = await this.translate(task);
      } else if (task.toLowerCase().includes('reason') || task.toLowerCase().includes('explain')) {
        result = await this.reason(task);
      } else {
        result = await this.process(task);
      }

      const executionTime = Date.now() - startTime;

      // Record interaction in feedback loop
      interactionId = await feedbackLoop.record(
        task,
        typeof result === 'string' ? result : JSON.stringify(result),
        { agent: 'autonomous', ...options }
      );

      // Learn from this execution
      await this.learn(task, result, executionTime);

      // Update metrics
      this.tasksProcessed++;
      this.successRate = (this.successRate * (this.tasksProcessed - 1) + 1) / this.tasksProcessed;

      this.emit('taskCompleted', { taskId, executionTime, interactionId });

      return {
        success: true,
        result,
        executionTime,
        learned: !!learned,
        confidence: this.calculateConfidence(task, result),
        interactionId
      };

    } catch (error) {
      console.error('Autonomous agent failed:', error);

      // Record failure
      if (!interactionId) {
        interactionId = await feedbackLoop.record(
          task,
          error.message,
          { agent: 'autonomous', error: true, ...options }
        );
      }

      // Try fallback strategy
      return this.handleFailure(task, error, interactionId);
    }
  }

  // ... (all other methods unchanged: analyze, generate, summarize, translate, reason, process, learn, recall, etc.)

  /**
   * Handle failure with fallback (modified to accept interactionId)
   */
  async handleFailure(task, error, interactionId) {
    this.successRate *= 0.9;

    // Simple fallback
    return {
      success: false,
      error: error.message,
      fallback: `Autonomous agent encountered an error. Basic processing: ${task.substring(0, 100)}...`,
      timestamp: new Date().toISOString(),
      interactionId
    };
  }

  // ... rest of original methods remain the same
}

// Export a singleton instance (like other agents)
module.exports = new AutonomousAgent();
