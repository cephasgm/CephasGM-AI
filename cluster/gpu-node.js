/**
 * GPU Node - Distributed GPU compute node
 */
const { exec } = require("child_process");
const util = require("util");
const os = require("os");
const EventEmitter = require("events");

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
      temperature: 0
    };
    
    this.ollamaAvailable = false;
    this.modelsLoaded = new Set();
    
    this.initialize();
  }

  /**
   * Initialize GPU node
   */
  async initialize() {
    console.log(`🖥️ Initializing ${this.id}...`);
    
    await this.checkGPU();
    await this.checkOllama();
    
    this.status = 'ready';
    this.emit('ready', this.id);
    
    console.log(`✅ ${this.id} ready - GPU: ${this.gpuInfo ? 'Available' : 'Not available'}`);
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
          // No NVIDIA GPU
          this.gpuInfo = {
            name: 'CPU (No GPU)',
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
      this.gpuInfo = { available: false };
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
      
      // Get loaded models
      try {
        const { stdout } = await execPromise('ollama list');
        const lines = stdout.split('\n').slice(1);
        lines.forEach(line => {
          if (line.trim()) {
            const modelName = line.split(/\s+/)[0];
            this.modelsLoaded.add(modelName);
          }
        });
      } catch {
        // No models loaded yet
      }
      
    } catch {
      console.log('⚠️ Ollama not found - using simulation mode');
      this.ollamaAvailable = false;
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
      
      if (this.ollamaAvailable) {
        result = await this.runOllama(prompt, model, options);
      } else {
        result = await this.simulateInference(prompt, model);
      }

      const inferenceTime = Date.now() - startTime;
      
      // Update metrics
      this.metrics.tasksProcessed++;
      this.metrics.totalInferenceTime += inferenceTime;

      return {
        success: true,
        nodeId: this.id,
        model,
        prompt,
        output: result.output,
        inferenceTime,
        gpu: this.gpuInfo?.available || false,
        ...result
      };

    } catch (error) {
      console.error(`${this.id} inference failed:`, error);
      
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
  async runOllama(prompt, model, options) {
    // Ensure model is loaded
    if (!this.modelsLoaded.has(model)) {
      console.log(`Loading model ${model}...`);
      try {
        await execPromise(`ollama pull ${model}`);
        this.modelsLoaded.add(model);
      } catch (error) {
        console.log(`Failed to load model ${model}, using simulation`);
        return this.simulateInference(prompt, model);
      }
    }

    const { stdout } = await execPromise(
      `ollama run ${model} "${prompt.replace(/"/g, '\\"')}"`,
      { timeout: options.timeout || 30000 }
    );

    return {
      output: stdout.trim(),
      provider: 'ollama',
      model
    };
  }

  /**
   * Simulate inference for demo
   */
  async simulateInference(prompt, model) {
    // Simulate GPU processing time
    const processingTime = this.gpuInfo?.available ? 500 : 2000;
    await new Promise(resolve => setTimeout(resolve, processingTime));

    const responses = {
      'llama3': `[Llama3 simulation] I understand you're asking about "${prompt.substring(0, 50)}". This is a simulated response from the GPU node.`,
      'mistral': `[Mistral simulation] Based on your query "${prompt.substring(0, 40)}", I can provide insights...`,
      'codellama': `[CodeLlama simulation] Here's code related to "${prompt.substring(0, 30)}"...`
    };

    return {
      output: responses[model] || `Simulated inference for "${prompt.substring(0, 50)}..."`,
      provider: 'simulation',
      model
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
      metrics: this.metrics,
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
      
      await execPromise(`ollama pull ${modelName}`);
      this.modelsLoaded.add(modelName);
      
      return {
        success: true,
        model: modelName,
        nodeId: this.id
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
   * Unload a model
   */
  unloadModel(modelName) {
    // Ollama keeps models loaded, so this is just tracking
    this.modelsLoaded.delete(modelName);
    
    return {
      success: true,
      model: modelName,
      unloaded: true
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
        temperature: 0
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
        timestamp: Date.now()
      };
      
    } catch {
      return {
        gpuUtilization: 0,
        memoryUtilization: 0,
        temperature: 0
      };
    }
  }

  /**
   * Shutdown node
   */
  async shutdown() {
    console.log(`🛑 Shutting down ${this.id}...`);
    this.status = 'shutting_down';
    
    // Unload models
    this.modelsLoaded.clear();
    
    this.status = 'stopped';
    this.emit('shutdown', this.id);
    
    return {
      success: true,
      nodeId: this.id
    };
  }
}

module.exports = GPUNode;
