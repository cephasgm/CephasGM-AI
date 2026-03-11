/**
 * Worker Node (Inference Node)
 * Executes AI inference tasks using local models
 */
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const EventEmitter = require('events');

const execPromise = util.promisify(exec);

class WorkerNode extends EventEmitter {
  constructor(id = null) {
    super();
    
    this.id = id || `worker-${Date.now()}`;
    this.status = 'initializing';
    this.models = new Map();
    this.metrics = {
      tasksProcessed: 0,
      totalInferenceTime: 0,
      successfulTasks: 0,
      failedTasks: 0,
      startTime: Date.now()
    };
    
    this.ollamaAvailable = false;
    this.supportedModels = ['llama3', 'mistral', 'codellama', 'phi3'];
    
    this.initialize();
  }

  /**
   * Initialize worker node
   */
  async initialize() {
    console.log(`🖥️ Initializing worker node: ${this.id}`);
    
    await this.checkOllama();
    
    this.status = 'ready';
    
    console.log(`✅ Worker node ${this.id} ready - Ollama: ${this.ollamaAvailable ? '✓' : '✗'}`);
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execPromise('ollama --version');
      this.ollamaAvailable = true;
      
      // Get available models
      await this.getAvailableModels();
      
    } catch {
      console.log(`⚠️ Worker ${this.id}: Ollama not found - using simulation mode`);
      this.ollamaAvailable = false;
    }
  }

  /**
   * Get available models from Ollama
   */
  async getAvailableModels() {
    try {
      const { stdout } = await execPromise('ollama list');
      const lines = stdout.split('\n').slice(1);
      
      lines.forEach(line => {
        if (line.trim()) {
          const [name] = line.split(/\s+/);
          this.models.set(name, {
            name,
            loaded: true,
            lastUsed: null
          });
        }
      });
      
      console.log(`📦 Worker ${this.id} has ${this.models.size} models available`);
      
    } catch (error) {
      console.log(`Failed to get models: ${error.message}`);
    }
  }

  /**
   * Run inference on this worker
   */
  async run(prompt, options = {}) {
    const {
      model = 'llama3',
      temperature = 0.7,
      maxTokens = 500,
      timeout = 30000
    } = options;

    const taskId = this.generateTaskId();
    const startTime = Date.now();

    console.log(`🎯 [${taskId}] Worker ${this.id} running ${model}`);

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    try {
      let result;

      if (this.ollamaAvailable && this.models.has(model)) {
        result = await this.runOllama(prompt, model, timeout);
      } else {
        result = await this.simulateInference(prompt, model);
      }

      const inferenceTime = Date.now() - startTime;

      // Update metrics
      this.metrics.tasksProcessed++;
      this.metrics.successfulTasks++;
      this.metrics.totalInferenceTime += inferenceTime;

      // Update model last used
      if (this.models.has(model)) {
        this.models.get(model).lastUsed = new Date().toISOString();
      }

      this.emit('taskCompleted', {
        taskId,
        model,
        inferenceTime
      });

      return {
        success: true,
        taskId,
        workerId: this.id,
        model,
        output: result,
        inferenceTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ [${taskId}] Worker ${this.id} failed:`, error.message);

      this.metrics.failedTasks++;

      this.emit('taskFailed', {
        taskId,
        model,
        error: error.message
      });

      return {
        success: false,
        taskId,
        workerId: this.id,
        error: error.message,
        model
      };
    }
  }

  /**
   * Run inference with Ollama
   */
  async runOllama(prompt, model, timeout) {
    // Escape quotes in prompt
    const escapedPrompt = prompt.replace(/"/g, '\\"');
    
    const { stdout, stderr } = await execPromise(
      `ollama run ${model} "${escapedPrompt}"`,
      { timeout }
    );

    if (stderr) {
      console.warn(`Ollama warning: ${stderr}`);
    }

    return stdout.trim();
  }

  /**
   * Simulate inference for demo
   */
  async simulateInference(prompt, model) {
    // Simulate processing time
    const processingTime = 500 + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, processingTime));

    const responses = {
      'llama3': `[Llama3 simulation] Based on your query: "${prompt.substring(0, 50)}..." I understand you're asking about this topic. In a production environment with Ollama, you would get real model output.`,
      
      'mistral': `[Mistral simulation] Analyzing "${prompt.substring(0, 50)}..." This is a simulated response. Install Ollama and pull the mistral model for real inference.`,
      
      'codellama': `[CodeLlama simulation] For your coding request: "${prompt.substring(0, 50)}..." Here's a simulated code response:\n\n// Example code\nfunction example() {\n  return "Hello from CodeLlama simulation";\n}`,
      
      'phi3': `[Phi-3 simulation] Quick response to: "${prompt.substring(0, 50)}..." This is running in simulation mode.`
    };

    return responses[model] || `[Simulation] Processing: "${prompt.substring(0, 50)}..."`;
  }

  /**
   * Load a model onto this worker
   */
  async loadModel(modelName) {
    if (!this.ollamaAvailable) {
      return {
        success: false,
        error: 'Ollama not available',
        workerId: this.id
      };
    }

    try {
      console.log(`Loading model ${modelName} on worker ${this.id}...`);
      
      const { stdout } = await execPromise(`ollama pull ${modelName}`);
      
      this.models.set(modelName, {
        name: modelName,
        loaded: true,
        loadedAt: new Date().toISOString(),
        lastUsed: null
      });

      return {
        success: true,
        workerId: this.id,
        model: modelName,
        output: stdout
      };

    } catch (error) {
      return {
        success: false,
        workerId: this.id,
        model: modelName,
        error: error.message
      };
    }
  }

  /**
   * Unload a model
   */
  unloadModel(modelName) {
    // Ollama keeps models loaded, so this is just tracking
    if (this.models.has(modelName)) {
      this.models.delete(modelName);
      return { success: true, workerId: this.id, model: modelName };
    }
    
    return { success: false, workerId: this.id, error: 'Model not found' };
  }

  /**
   * Get worker status
   */
  getStatus() {
    return {
      id: this.id,
      status: this.status,
      ollamaAvailable: this.ollamaAvailable,
      models: Array.from(this.models.values()),
      metrics: {
        ...this.metrics,
        averageInferenceTime: this.metrics.successfulTasks > 0 
          ? this.metrics.totalInferenceTime / this.metrics.successfulTasks 
          : 0,
        uptime: Date.now() - this.metrics.startTime
      },
      system: {
        platform: os.platform(),
        cpus: os.cpus().length,
        memory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + 'GB',
        freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)) + 'GB'
      }
    };
  }

  /**
   * Check if model is available
   */
  hasModel(modelName) {
    return this.models.has(modelName);
  }

  /**
   * Get available models
   */
  getAvailableModels() {
    return Array.from(this.models.values());
  }

  /**
   * Generate task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Shutdown worker
   */
  async shutdown() {
    console.log(`🛑 Shutting down worker ${this.id}...`);
    this.status = 'shutting_down';
    
    // Clean up
    this.models.clear();
    
    this.status = 'stopped';
    this.emit('shutdown', this.id);
    
    return {
      success: true,
      workerId: this.id
    };
  }
}

// Create default worker instance
const defaultWorker = new WorkerNode('worker-1');

// Also export class for creating multiple workers
module.exports = defaultWorker;
module.exports.WorkerNode = WorkerNode;
