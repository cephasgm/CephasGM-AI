/**
 * GPU Node - Distributed GPU compute node
 */
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs").promises;

const execPromise = util.promisify(exec);

class GPUNode extends EventEmitter {
  constructor(id = null) {
    super();
    
    this.id = id || `gpu-node-${Date.now()}`;
    this.status = 'initializing';
    this.gpuInfo = null;
    this.metrics = {
      tasksProcessed: 0,
      totalInferenceTime: 0,
      memoryUsed: 0,
      temperature: 0,
      successCount: 0,
      failureCount: 0
    };
    
    this.ollamaAvailable = false;
    this.modelsLoaded = new Set();
    this.modelPaths = new Map();
    
    this.initialize();
  }

  /**
   * Initialize GPU node
   */
  async initialize() {
    console.log(`🖥️ Initializing ${this.id}...`);
    
    await this.checkGPU();
    await this.checkOllama();
    await this.checkModels();
    
    this.status = 'ready';
    this.emit('ready', this.id);
    
    console.log(`✅ ${this.id} ready - GPU: ${this.gpuInfo?.available ? 'Available' : 'Not available'}`);
  }

  /**
   * Check GPU availability
   */
  async checkGPU() {
    try {
      if (os.platform() === 'linux' || os.platform() === 'win32') {
        try {
          const { stdout } = await execPromise('nvidia-smi --query-gpu=name,memory.total,temperature.gpu --format=csv,noheader');
          const [name, memory, temp] = stdout.split(',').map(s => s.trim());
          
          this.gpuInfo = {
            name,
            memory: memory,
            temperature: temp,
            available: true
          };
          
          console.log(`🎮 GPU detected: ${name}`);
        } catch {
          // No NVIDIA GPU or nvidia-smi not available
          this.gpuInfo = {
            name: 'CPU (No GPU detected)',
            available: false
          };
        }
      } else {
        this.gpuInfo = {
          name: `${os.platform()} (GPU detection not supported)`,
          available: false
        };
      }
    } catch (error) {
      console.log('GPU check failed:', error.message);
      this.gpuInfo = { 
        name: 'Unknown',
        available: false 
      };
    }
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execPromise('ollama --version');
      this.ollamaAvailable = true;
      console.log('✅ Ollama detected');
    } catch {
      console.log('⚠️ Ollama not found - using simulation mode');
      this.ollamaAvailable = false;
    }
  }

  /**
   * Check available models
   */
  async checkModels() {
    if (!this.ollamaAvailable) return;
    
    try {
      const { stdout } = await execPromise('ollama list');
      const lines = stdout.split('\n').slice(1);
      
      lines.forEach(line => {
        if (line.trim()) {
          const parts = line.trim().split(/\s+/);
          const modelName = parts[0];
          this.modelsLoaded.add(modelName);
        }
      });
      
      console.log(`📦 Models available: ${Array.from(this.modelsLoaded).join(', ') || 'none'}`);
      
    } catch (error) {
      console.log('Failed to list models:', error.message);
    }
  }

  /**
   * Run inference on GPU
   */
  async run(prompt, model = 'llama3', options = {}) {
    const startTime = Date.now();
    
    console.log(`🎯 ${this.id} running inference with ${model}`);
    
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    try {
      let result;
      let success = true;
      
      if (this.ollamaAvailable && this.modelsLoaded.has(model)) {
        result = await this.runOllama(prompt, model, options);
      } else if (this.ollamaAvailable) {
        // Try to pull the model first
        console.log(`📥 Model ${model} not found, attempting to pull...`);
        const pullResult = await this.pullModel(model);
        if (pullResult.success) {
          result = await this.runOllama(prompt, model, options);
        } else {
          result = await this.simulateInference(prompt, model);
        }
      } else {
        result = await this.simulateInference(prompt, model);
      }

      const inferenceTime = Date.now() - startTime;
      
      // Update metrics
      this.metrics.tasksProcessed++;
      this.metrics.totalInferenceTime += inferenceTime;
      if (success) {
        this.metrics.successCount++;
      } else {
        this.metrics.failureCount++;
      }

      return {
        success: true,
        nodeId: this.id,
        model,
        prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
        output: result.output,
        inferenceTime,
        gpu: this.gpuInfo?.available || false,
        ...result
      };

    } catch (error) {
      console.error(`${this.id} inference failed:`, error);
      
      this.metrics.failureCount++;
      
      return {
        success: false,
        nodeId: this.id,
        error: error.message,
        model,
        prompt: prompt.substring(0, 100)
      };
    }
  }

  /**
   * Run inference with Ollama
   */
  async runOllama(prompt, model, options) {
    try {
      // Escape quotes in prompt
      const escapedPrompt = prompt.replace(/"/g, '\\"');
      
      const { stdout, stderr } = await execPromise(
        `ollama run ${model} "${escapedPrompt}"`,
        { timeout: options.timeout || 30000 }
      );

      if (stderr) {
        console.warn(`Ollama warning: ${stderr}`);
      }

      return {
        output: stdout.trim(),
        provider: 'ollama',
        model,
        streaming: false
      };
      
    } catch (error) {
      console.log(`Ollama execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Pull a model
   */
  async pullModel(modelName) {
    try {
      console.log(`Downloading model ${modelName}...`);
      
      const process = exec(`ollama pull ${modelName}`);
      
      return new Promise((resolve, reject) => {
        let output = '';
        
        process.stdout.on('data', (data) => {
          output += data.toString();
          console.log(`📥 ${data.toString().trim()}`);
        });
        
        process.stderr.on('data', (data) => {
          console.error(`⚠️ ${data.toString().trim()}`);
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            this.modelsLoaded.add(modelName);
            resolve({ 
              success: true, 
              model: modelName,
              output 
            });
          } else {
            reject(new Error(`Failed to pull model ${modelName}`));
          }
        });
        
        process.on('error', reject);
      });
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: modelName
      };
    }
  }

  /**
   * Simulate inference for demo
   */
  async simulateInference(prompt, model) {
    // Simulate processing time based on prompt length
    const processingTime = this.gpuInfo?.available ? 500 : 2000;
    await new Promise(resolve => setTimeout(resolve, processingTime));

    const responses = {
      'llama3': `[Llama3 simulation] I understand you're asking about "${prompt.substring(0, 50)}". This is a simulated response from the GPU node. To use real models, install Ollama and pull the llama3 model.`,
      
      'mistral': `[Mistral simulation] Based on your query "${prompt.substring(0, 40)}", I can provide insights... This is running in simulation mode.`,
      
      'codellama': `[CodeLlama simulation] Here's code related to "${prompt.substring(0, 30)}":\n\n// Generated code would appear here\nfunction example() {\n  return "Simulated response";\n}`,
      
      'phi3': `[Phi-3 simulation] Processing: "${prompt.substring(0, 50)}"...\n\nThis is a placeholder response. For production use, please set up Ollama.`
    };

    return {
      output: responses[model] || `Simulated inference for model "${model}" with prompt: "${prompt.substring(0, 50)}..."`,
      provider: 'simulation',
      model,
      simulated: true
    };
  }

  /**
   * Get node status
   */
  getStatus() {
    return {
      id: this.id,
      status: this.status,
      gpu: this.gpuInfo,
      metrics: {
        ...this.metrics,
        averageInferenceTime: this.metrics.tasksProcessed > 0 
          ? this.metrics.totalInferenceTime / this.metrics.tasksProcessed 
          : 0,
        successRate: this.metrics.tasksProcessed > 0
          ? (this.metrics.successCount / this.metrics.tasksProcessed * 100).toFixed(1) + '%'
          : '0%'
      },
      modelsLoaded: Array.from(this.modelsLoaded),
      ollamaAvailable: this.ollamaAvailable
    };
  }

  /**
   * Load a model onto the GPU
   */
  async loadModel(modelName) {
    if (!this.ollamaAvailable) {
      return {
        success: false,
        error: 'Ollama not available',
        model: modelName
      };
    }

    try {
      console.log(`Loading model ${modelName} on ${this.id}...`);
      
      const result = await this.pullModel(modelName);
      
      return {
        success: true,
        model: modelName,
        nodeId: this.id,
        ...result
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        model: modelName
      };
    }
  }

  /**
   * Unload a model (remove from memory)
   */
  async unloadModel(modelName) {
    // Ollama keeps models in memory, so this is just tracking
    this.modelsLoaded.delete(modelName);
    
    return {
      success: true,
      model: modelName,
      unloaded: true,
      note: 'Model removed from tracking (Ollama may keep it in memory)'
    };
  }

  /**
   * Get GPU utilization
   */
  async getUtilization() {
    if (!this.gpuInfo?.available) {
      return {
        gpuUtilization: 0,
        memoryUtilization: 0,
        temperature: 0,
        available: false
      };
    }

    try {
      const { stdout } = await execPromise(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu --format=csv,noheader'
      );
      
      const [util, memUsed, temp] = stdout.split(',').map(s => s.trim());
      
      return {
        gpuUtilization: parseInt(util.replace('%', '')),
        memoryUtilization: memUsed,
        temperature: parseInt(temp),
        available: true,
        timestamp: Date.now()
      };
      
    } catch {
      return {
        gpuUtilization: 0,
        memoryUtilization: 0,
        temperature: 0,
        available: false,
        error: 'Failed to get utilization'
      };
    }
  }

  /**
   * Test node connectivity
   */
  async ping() {
    return {
      id: this.id,
      status: this.status,
      latency: Date.now(),
      gpu: this.gpuInfo?.available || false
    };
  }

  /**
   * Get node performance metrics
   */
  getPerformance() {
    const avgTime = this.metrics.tasksProcessed > 0 
      ? this.metrics.totalInferenceTime / this.metrics.tasksProcessed 
      : 0;
    
    return {
      tasksPerSecond: avgTime > 0 ? 1000 / avgTime : 0,
      averageResponseTime: avgTime,
      throughput: this.metrics.tasksProcessed / (Date.now() - this.metrics.startTime || 1) * 1000,
      successRate: this.metrics.tasksProcessed > 0
        ? (this.metrics.successCount / this.metrics.tasksProcessed * 100).toFixed(1)
        : 0
    };
  }

  /**
   * Shutdown node
   */
  async shutdown() {
    console.log(`🛑 Shutting down ${this.id}...`);
    this.status = 'shutting_down';
    
    // Clear models from tracking
    this.modelsLoaded.clear();
    
    this.status = 'stopped';
    this.emit('shutdown', this.id);
    
    return {
      success: true,
      nodeId: this.id,
      metrics: this.metrics
    };
  }
}

module.exports = GPUNode;
