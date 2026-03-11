/**
 * Autonomous Agent - Self-learning, adaptable agent
 * Can handle general tasks and learn from interactions
 */
const EventEmitter = require('events');
const fetch = require('node-fetch');
const vm = require('vm');

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
   * Execute a task
   */
  async execute(task, options = {}) {
    const startTime = Date.now();
    const taskId = `task_${Date.now()}`;

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

      // Learn from this execution
      await this.learn(task, result, executionTime);

      // Update metrics
      this.tasksProcessed++;
      this.successRate = (this.successRate * (this.tasksProcessed - 1) + 1) / this.tasksProcessed;

      this.emit('taskCompleted', { taskId, executionTime });

      return {
        success: true,
        result,
        executionTime,
        learned: !!learned,
        confidence: this.calculateConfidence(task, result)
      };

    } catch (error) {
      console.error('Autonomous agent failed:', error);

      // Try fallback strategy
      return this.handleFailure(task, error);
    }
  }

  /**
   * Analyze task
   */
  async analyze(task) {
    const target = task.replace(/analyze|examine|study/gi, '').trim();
    
    return {
      analysis: `Analysis of "${target}":`,
      findings: [
        `• Key components identified`,
        `• Patterns detected`,
        `• Relationships established`
      ],
      confidence: 0.85,
      recommendations: [
        `Consider deeper investigation`,
        `Cross-reference with knowledge base`
      ]
    };
  }

  /**
   * Generate content
   */
  async generate(task) {
    const prompt = task.replace(/generate|create|make/gi, '').trim();
    
    return `Generated content based on: "${prompt}"\n\n` +
           `This is autonomously generated content. In production, this would connect to language models or generation APIs.`;
  }

  /**
   * Summarize text
   */
  async summarize(task) {
    const text = task.replace(/summarize|summary of/gi, '').trim();
    
    return `Summary: ${text.substring(0, 100)}... [Autonomous summarization complete]`;
  }

  /**
   * Translate text
   */
  async translate(task) {
    const text = task.replace(/translate|convert/gi, '').trim();
    
    return `[Translation] ${text} (autonomous translation)`;
  }

  /**
   * Reason about a topic
   */
  async reason(task) {
    const topic = task.replace(/reason|explain|why/gi, '').trim();
    
    return {
      topic,
      reasoning: [
        `• Based on available information...`,
        `• Considering multiple perspectives...`,
        `• Drawing conclusions from patterns...`
      ],
      conclusion: `Autonomous reasoning suggests that ${topic} involves multiple factors.`
    };
  }

  /**
   * Process general task
   */
  async process(task) {
    // Simulate processing
    await this.simulateDelay(500);

    return `Autonomously processed: ${task.substring(0, 100)}...\n` +
           `This is a general-purpose autonomous response. The agent is learning and adapting.`;
  }

  /**
   * Learn from experience
   */
  async learn(task, result, executionTime) {
    // Store in memory
    this.memory.push({
      task: task.substring(0, 200),
      result: typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result),
      executionTime,
      timestamp: Date.now()
    });

    // Keep memory manageable
    if (this.memory.length > 100) {
      this.memory = this.memory.slice(-100);
    }

    // Extract patterns for similar tasks
    const pattern = this.extractPattern(task);
    const existing = this.learnedPatterns.get(pattern) || {
      count: 0,
      results: []
    };

    existing.count++;
    existing.results.push(result);
    existing.lastSeen = Date.now();

    if (existing.count > 3) {
      // Consolidate learning
      existing.pattern = this.consolidatePattern(existing.results);
    }

    this.learnedPatterns.set(pattern, existing);

    // Emit learning event
    this.emit('learned', {
      pattern,
      confidence: existing.count / 10,
      timestamp: Date.now()
    });
  }

  /**
   * Recall similar task
   */
  recall(task) {
    const pattern = this.extractPattern(task);
    const learned = this.learnedPatterns.get(pattern);

    if (learned && learned.count > 2 && learned.pattern) {
      return learned.pattern;
    }

    return null;
  }

  /**
   * Extract pattern from task
   */
  extractPattern(task) {
    // Simple pattern extraction
    const words = task.toLowerCase().split(/\s+/);
    const keyWords = words.filter(w => w.length > 4);
    return keyWords.sort().join('_').substring(0, 50);
  }

  /**
   * Consolidate multiple results into pattern
   */
  consolidatePattern(results) {
    if (results.length === 0) return null;

    // Simple consolidation
    const first = results[0];
    if (typeof first === 'string') {
      return first.substring(0, 100) + ' [consolidated pattern]';
    }

    return { consolidated: true, sample: results[0] };
  }

  /**
   * Calculate confidence in result
   */
  calculateConfidence(task, result) {
    let confidence = this.successRate * 0.7;

    // Check if similar task was learned
    const learned = this.learnedPatterns.get(this.extractPattern(task));
    if (learned) {
      confidence += 0.2 * Math.min(learned.count / 10, 1);
    }

    // Check task complexity
    const complexity = task.length / 500;
    confidence *= (1 - complexity * 0.3);

    return Math.min(confidence, 1.0);
  }

  /**
   * Handle failure with fallback
   */
  async handleFailure(task, error) {
    this.successRate *= 0.9;

    // Simple fallback
    return {
      success: false,
      error: error.message,
      fallback: `Autonomous agent encountered an error. Basic processing: ${task.substring(0, 100)}...`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get agent info
   */
  getInfo() {
    return {
      id: this.id,
      type: this.type,
      capabilities: this.capabilities,
      metrics: {
        tasksProcessed: this.tasksProcessed,
        successRate: this.successRate,
        memorySize: this.memory.length,
        learnedPatterns: this.learnedPatterns.size
      },
      config: this.config
    };
  }

  /**
   * Learn from feedback
   */
  async learnFromFeedback(taskId, feedback) {
    console.log(`📝 Learning from feedback: ${feedback}`);

    // Adjust learning rate based on feedback
    if (feedback.toLowerCase().includes('good') || feedback.toLowerCase().includes('correct')) {
      this.config.learningRate *= 1.1;
    } else if (feedback.toLowerCase().includes('bad') || feedback.toLowerCase().includes('wrong')) {
      this.config.learningRate *= 0.9;
    }

    this.emit('feedbackLearned', { taskId, feedback });
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutonomousAgent;
