/**
 * Model Host - Manages local AI model hosting and inference
 * Updated for Render deployment - with GPU fallback
 */
const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { checkGpuAvailability } = require('../utils/gpu-check');

class ModelHost extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'llama3': { 
        name: 'llama3',
        size: '8B',
        type: 'llm',
        backend: 'ollama',
        port: 11434
      },
      'mistral': {
        name: 'mistral',
        size: '7B',
        type: 'llm',
        backend: 'ollama',
        port: 11434
      },
      'phi3': {
        name: 'phi3',
        size: '3.8B',
        type: 'llm',
        backend: 'ollama',
        port: 11434
      },
      'whisper': {
        name: 'whisper',
        type: 'audio',
        backend: 'local',
        port: null
      }
    };
    
    this.activeModels = new Map();
    this.modelProcesses = new Map();
    this.gpuAvailable = false; // Will be set in initialization
    
    // Initialize GPU check asynchronously
    this.initializeGPUCheck();
  }

  /**
   * Initialize GPU check asynchronously
   */
  async initializeGPUCheck() {
    try {
      this.gpuAvailable = await checkGpuAvailability();
      console.log(`Model host initialized. GPU available: ${this.gpuAvailable}`);
      
      if (!this.gpuAvailable) {
        console.log('⚠️  Running in CPU-only mode - inference will be simulated');
        console.log('💡 To use GPU acceleration, deploy on a GPU-enabled service');
      }
    } catch (error) {
      console.log('Model host initialized. GPU available: false');
      this.gpuAvailable = false;
    }
  }

  /**
   * Check GPU availability (synchronous wrapper for backward compatibility)
   */
  checkGpuAvailability() {
    // This is kept for backward compatibility
    // Returns false by default to prevent spawn errors
    return this.gpuAvailable;
  }

  /**
   * Load a model into memory
   */
  async loadModel(modelName, options = {}) {
    try {
      const model = this.models[modelName];
      
      if (!model) {
        throw new Error(`Model ${modelName} not found`);
      }

      if (this.activeModels.has(modelName)) {
        console.log(`Model ${modelName} already loaded`);
        return this.activeModels.get(modelName);
      }

      console.log(`Loading model: ${modelName}...`);

      // Start model based on backend
      let modelInstance;
      
      switch (model.backend) {
        case 'ollama':
          // Check if we can actually run Ollama
          if (this.gpuAvailable) {
            modelInstance = await this.startOllamaModel(modelName, options);
          } else {
            console.log(`⚠️  Ollama requires GPU - starting ${modelName} in simulation mode`);
            modelInstance = await this.startLocalModel(modelName, options);
          }
          break;
        case 'local':
          modelInstance = await this.startLocalModel(modelName, options);
          break;
        default:
          throw new Error(`Unknown backend for model ${modelName}`);
      }

      this.activeModels.set(modelName, modelInstance);
      this.emit('modelLoaded', { model: modelName, timestamp: new Date() });

      console.log(`✅ Model ${modelName} loaded successfully`);
      return modelInstance;

    } catch (error) {
      console.error(`❌ Failed to load model ${modelName}:`, error);
      throw error;
    }
  }

  /**
   * Start Ollama model
   */
  async startOllamaModel(modelName, options) {
    return new Promise((resolve, reject) => {
      try {
        const process = spawn('ollama', ['run', modelName]);
        
        let output = '';
        let resolved = false;
        
        process.stdout.on('data', (data) => {
          output += data.toString();
          if (output.includes('success') && !resolved) {
            resolved = true;
            resolve({
              name: modelName,
              backend: 'ollama',
              process: process,
              endpoint: `http://localhost:11434/api/generate`
            });
          }
        });

        process.stderr.on('data', (data) => {
          const errorMsg = data.toString();
          console.error(`Ollama error: ${errorMsg}`);
          
          // If Ollama is not installed, fall back to simulation
          if (errorMsg.includes('not found') || errorMsg.includes('No such file')) {
            if (!resolved) {
              resolved = true;
              console.log(`⚠️  Ollama not found, falling back to simulation mode for ${modelName}`);
              resolve(this.createSimulatedModel(modelName));
            }
          }
        });

        process.on('error', (error) => {
          console.log(`⚠️  Ollama error (${error.message}), falling back to simulation`);
          if (!resolved) {
            resolved = true;
            resolve(this.createSimulatedModel(modelName));
          }
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log(`⚠️  Ollama timeout, falling back to simulation for ${modelName}`);
            resolve(this.createSimulatedModel(modelName));
          }
        }, 10000);

        this.modelProcesses.set(modelName, process);

      } catch (error) {
        console.log(`⚠️  Failed to start Ollama, using simulation for ${modelName}`);
        resolve(this.createSimulatedModel(modelName));
      }
    });
  }

  /**
   * Create a simulated model instance
   */
  createSimulatedModel(modelName) {
    return {
      name: modelName,
      backend: 'simulated',
      endpoint: 'simulated://model',
      loaded: true,
      simulated: true
    };
  }

  /**
   * Start local model (simulated)
   */
  async startLocalModel(modelName, options) {
    // Simulate model loading
    await this.simulateDelay(2000);
    
    return {
      name: modelName,
      backend: 'local',
      endpoint: 'local://model',
      loaded: true,
      simulated: !this.gpuAvailable
    };
  }

  /**
   * Unload a model from memory
   */
  async unloadModel(modelName) {
    const process = this.modelProcesses.get(modelName);
    
    if (process) {
      try {
        process.kill();
      } catch (error) {
        // Ignore kill errors
      }
      this.modelProcesses.delete(modelName);
    }
    
    this.activeModels.delete(modelName);
    
    console.log(`Model ${modelName} unloaded`);
    this.emit('modelUnloaded', { model: modelName, timestamp: new Date() });
  }

  /**
   * Run inference on a model
   */
  async infer(modelName, input, options = {}) {
    try {
      const model = this.activeModels.get(modelName);
      
      if (!model) {
        // Try to load the model
        console.log(`Model ${modelName} not loaded, attempting to load...`);
        await this.loadModel(modelName);
        return this.infer(modelName, input, options);
      }

      console.log(`Running inference on ${modelName}...`);

      // Route to appropriate inference method
      let result;
      
      switch (model.backend) {
        case 'ollama':
          result = await this.ollamaInfer(model, input, options);
          break;
        case 'local':
        case 'simulated':
          result = await this.simulateInfer(input);
          break;
        default:
          result = await this.simulateInfer(input);
      }

      return {
        success: true,
        model: modelName,
        input: input.substring(0, 100) + (input.length > 100 ? '...' : ''),
        output: result,
        simulated: model.simulated || false,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Inference error on ${modelName}:`, error);
      return {
        success: false,
        error: error.message,
        model: modelName,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Ollama inference
   */
  async ollamaInfer(model, input, options) {
    // If model is simulated, just simulate
    if (model.simulated) {
      return this.simulateInfer(input);
    }

    try {
      const fetch = require('node-fetch');
      
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.name,
          prompt: input,
          stream: false,
          options: options
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json();
      return data.response;

    } catch (error) {
      console.log(`⚠️  Ollama inference failed (${error.message}), using simulation`);
      return this.simulateInfer(input);
    }
  }

  /**
   * Simulate inference for demo/fallback
   */
  async simulateInfer(input) {
    await this.simulateDelay(500);
    
    const responses = [
      `Based on my analysis of "${input.substring(0, 50)}...", I can provide the following insights. This is a simulated response as the model is running in CPU/fallback mode.`,
      
      `The model has processed your request about ${input.substring(0, 40)}... In simulation mode, I'm generating a plausible response. For production use, consider deploying with GPU access.`,
      
      `After processing your query regarding ${input.substring(0, 45)}..., I understand you're asking about this topic. Please note this is a simulated inference - actual model output would be more sophisticated with GPU acceleration.`,
      
      `I've analyzed "${input.substring(0, 35)}..." and can confirm that this is a simulated response. The model is currently running without GPU acceleration, which limits inference capabilities.`,
      
      `Your request about ${input.substring(0, 40)}... has been processed. This is a fallback response from the simulation engine, as GPU-accelerated inference is not available in this environment.`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Get model status
   */
  getStatus() {
    const status = {
      gpuAvailable: this.gpuAvailable,
      environment: process.env.RENDER ? 'render' : 'unknown',
      activeModels: Array.from(this.activeModels.entries()).map(([name, model]) => ({
        name,
        backend: model.backend,
        endpoint: model.endpoint,
        loaded: true,
        simulated: model.simulated || false
      })),
      availableModels: Object.entries(this.models).map(([name, info]) => ({
        name,
        ...info,
        loaded: this.activeModels.has(name)
      }))
    };
    
    return status;
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clean up all models
   */
  async shutdown() {
    console.log('Shutting down model host...');
    
    for (const [name, process] of this.modelProcesses) {
      try {
        process.kill();
      } catch (error) {
        // Ignore kill errors
      }
    }
    
    this.activeModels.clear();
    this.modelProcesses.clear();
    
    console.log('✅ Model host shut down');
    this.emit('shutdown');
  }
}

// Create and initialize the model host instance
const modelHost = new ModelHost();

// Handle process signals
process.on('SIGTERM', async () => {
  await modelHost.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await modelHost.shutdown();
  process.exit(0);
});

module.exports = modelHost;
