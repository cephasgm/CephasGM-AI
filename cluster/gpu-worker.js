/**
 * GPU Worker - Inference node for GPU-accelerated models
 */
const { exec } = require('child_process');
const util = require('util');
const EventEmitter = require('events');

const execPromise = util.promisify(exec);

class GPUWorker extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.id = config.id || `gpu-${Date.now()}`;
    this.name = config.name || `GPU Worker ${this.id}`;
    this.capacity = config.capacity || 100;
    this.status = 'initializing';
    
    this.metrics = {
      tasksProcessed: 0,
      totalInferenceTime: 0,
      averageLatency: 0,
      successRate: 1.0,
      memoryUsed: 0
    };
    
    this.models = new Set();
    this.ollamaAvailable = false;
    
    this.initialize();
  }

  /**
   * Initialize GPU worker
   */
  async initialize() {
    console.log(`🖥️ Initializing ${this.id}...`);
    
    await this.checkOllama();
    
    this.status = 'ready';
    this.emit('ready', this.id);
    
    console.log(`✅ ${this.id} ready - Ollama: ${this.ollamaAvailable}`);
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execPromise('ollama --version');
      this.ollamaAvailable = true;
      
      // Get loaded models
      try {
        const { stdout } = await execPromise('ollama list');
        const lines = stdout.split('\n').slice(1);
        lines.forEach(line => {
          if (line.trim()) {
            const modelName = line.split(/\s+/)[0];
            this.models.add(modelName);
          }
        });
      } catch {
        // No models loaded yet
      }
      
    } catch {
      console.log(`⚠️ ${this.id}: Ollama not found - using simulation mode`);
      this.ollamaAvailable = false;
    }
  }

  /**
   * Run inference on GPU
   */
  async run(prompt, options = {}) {
    const {
      model = 'llama3',
      temperature = 0.7,
      maxTokens = 500,
      timeout = 30000
    } = options;

    const startTime = Date.now();
    const taskId = `task_${Date.now()}`;

    console.log(`🎯 ${this.id} running inference with ${model}`);

    try {
      let output;

      if (this.ollamaAvailable) {
        output = await this.runOllama(prompt, model, timeout);
      } else {
        output = await this.simulateInference(prompt, model);
      }

      const inferenceTime = Date.now() - startTime;

      // Update metrics
      this.metrics.tasksProcessed++;
      this.metrics.totalInferenceTime += inferenceTime;
      this.metrics.averageLatency = this.metrics.totalInferenceTime / this.metrics.tasksProcessed;

      this.emit('inferenceComplete', {
        taskId,
        model,
        inferenceTime
      });

      return {
        success: true,
        nodeId: this.id,
        model,
        output,
        inferenceTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`${this.id} inference failed:`, error);

      this.metrics.successRate *= 0.9;

      return {
        success: false,
        nodeId: this.id,
        error: error.message,
        model
      };
    }
  }

  /**
   * Run inference with Ollama
   */
  async runOllama(prompt, model, timeout) {
    // Ensure model is loaded
    if (!this.models.has(model)) {
      console.log(`Loading model ${model}...`);
      try {
        await execPromise(`ollama pull ${model}`);
        this.models.add(model);
      } catch (error) {
        throw new Error(`Failed to load model ${model}: ${error.message}`);
      }
    }

    const { stdout } = await execPromise(
      `ollama run ${model} "${prompt.replace(/"/g, '\\"')}"`,
      { timeout }
    );

    return stdout.trim();
  }

  /**
   * Simulate inference for demo
   */
  async simulateInference(prompt, model) {
    // Simulate GPU processing time
    const processingTime = 500 + Math.random() * 1000;
    await this.simulateDelay(processingTime);

    const responses = {
      'llama3': `[Llama3 simulation] I understand you're asking about "${prompt.substring(0, 50)}". This is a simulated response from ${this.id}.`,
      'mistral': `[Mistral simulation] Based on your query "${prompt.substring(0, 40)}", I can provide insights...`,
      'codellama': `[CodeLlama simulation] Here's code related to "${prompt.substring(0, 30)}"...`
    };

    return responses[model] || `Simulated inference from ${this.id} for: "${prompt.substring(0, 50)}..."`;
  }

  /**
   * Load a model
   */
  async loadModel(modelName) {
    if (!this.ollamaAvailable) {
      return {
        success: false,
        error: 'Ollama not available'
      };
    }

    try {
      await execPromise(`ollama pull ${modelName}`);
      this.models.add(modelName);
      
      return {
        success: true,
        model: modelName
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get worker status
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      metrics: this.metrics,
      modelsLoaded: Array.from(this.models),
      ollamaAvailable: this.ollamaAvailable
    };
  }

  /**
   * Get GPU utilization (simulated)
   */
  async getUtilization() {
    // Simulate GPU metrics
    return {
      gpuUtilization: 20 + Math.random() * 60,
      memoryUtilization: 30 + Math.random() * 40,
      temperature: 50 + Math.random() * 20,
      power: 150 + Math.random() * 50
    };
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GPUWorker;
