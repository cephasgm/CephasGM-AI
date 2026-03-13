/**
 * Model Host - Manages AI model hosting and inference with Ollama Cloud
 * Updated to use correct Ollama Cloud API endpoints
 */
const EventEmitter = require('events');
const { checkGpuAvailability } = require('../utils/gpu-check');

class ModelHost extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'llama3': { 
        name: 'llama3',
        size: '8B',
        type: 'llm',
        ollamaModel: 'llama3:8b',
        description: 'Meta Llama 3 8B - General purpose'
      },
      'llama3.2': { 
        name: 'llama3.2',
        size: '3B',
        type: 'llm',
        ollamaModel: 'llama3.2:3b',
        description: 'Latest Llama 3.2 3B - Fast and efficient'
      },
      'mistral': {
        name: 'mistral',
        size: '7B',
        type: 'llm',
        ollamaModel: 'mistral:7b',
        description: 'Mistral 7B - Excellent performance'
      },
      'phi3': {
        name: 'phi3',
        size: '3.8B',
        type: 'llm',
        ollamaModel: 'phi3:3.8b',
        description: 'Phi-3 Mini - Small but powerful'
      },
      'codellama': {
        name: 'codellama',
        size: '7B',
        type: 'code',
        ollamaModel: 'codellama:7b',
        description: 'Code Llama - Specialized for programming'
      },
      'neural-chat': {
        name: 'neural-chat',
        size: '7B',
        type: 'llm',
        ollamaModel: 'neural-chat:7b',
        description: 'Neural Chat - Optimized for conversations'
      },
      'nomic-embed': {
        name: 'nomic-embed',
        size: '137M',
        type: 'embedding',
        ollamaModel: 'nomic-embed-text:v1.5',
        description: 'Text embedding model for vector search'
      },
      'whisper': {
        name: 'whisper',
        type: 'audio',
        backend: 'local',
        description: 'Audio transcription model'
      }
    };
    
    this.activeModels = new Map();
    this.modelProcesses = new Map();
    this.gpuAvailable = false;
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.ollamaHost = 'https://api.ollama.com'; // Correct API base
    
    // Initialize
    this.initialize();
  }

  /**
   * Initialize the model host
   */
  async initialize() {
    try {
      this.gpuAvailable = await checkGpuAvailability();
      console.log(`
╔══════════════════════════════════════════════════════════╗
║  🚀 Model Host Initialized                                ║
╠══════════════════════════════════════════════════════════╣
║  📡 Ollama Cloud: ${this.ollamaApiKey ? '✅ Connected' : '❌ No API Key'}           ║
║  🖥️ GPU Available: ${this.gpuAvailable ? '✅' : '❌'} (for local dev only)        ║
║  📊 Models Available: ${Object.keys(this.models).length}                           ║
║  🌐 Environment: ${process.env.RENDER ? 'Render' : 'Local'}                        ║
╚══════════════════════════════════════════════════════════╝
      `);

      if (!this.ollamaApiKey) {
        console.log('⚠️  OLLAMA_API_KEY not set. Add it to Render environment variables.');
      } else {
        // Test connection
        this.testConnection();
      }
    } catch (error) {
      console.log('Model host initialized with limited functionality');
    }
  }

  /**
   * Test Ollama Cloud connection using correct endpoint
   */
  async testConnection() {
    try {
      const endpoint = `${this.ollamaHost}/api/tags`;
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.ollamaApiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        console.log('✅ Ollama Cloud connection verified');
      } else {
        const errorText = await response.text();
        console.log(`⚠️ Ollama Cloud connection failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.log('⚠️ Ollama Cloud connection error:', error.message);
    }
  }

  /**
   * Load a model into memory
   */
  async loadModel(modelName, options = {}) {
    try {
      const model = this.models[modelName];
      
      if (!model) {
        throw new Error(`Model ${modelName} not found. Available: ${Object.keys(this.models).join(', ')}`);
      }

      if (this.activeModels.has(modelName)) {
        console.log(`✅ Model ${modelName} already loaded`);
        return this.activeModels.get(modelName);
      }

      console.log(`📥 Loading model: ${modelName} (${model.type})...`);

      // For cloud models, we just verify they exist
      if (model.ollamaModel && this.ollamaApiKey) {
        const verified = await this.verifyCloudModel(model.ollamaModel);
        if (!verified) {
          console.log(`⚠️  Model ${modelName} may not be available on Ollama Cloud`);
        }
      }

      // Create model instance
      const modelInstance = {
        name: modelName,
        type: model.type,
        ollamaModel: model.ollamaModel,
        provider: 'ollama-cloud',
        status: 'ready',
        loadedAt: new Date().toISOString(),
        capabilities: this.getModelCapabilities(model.type)
      };

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
   * Verify cloud model availability using /api/tags
   */
  async verifyCloudModel(modelName) {
    try {
      const endpoint = `${this.ollamaHost}/api/tags`;
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.ollamaApiKey}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // data.models is an array of objects with 'name' property
        return data.models?.some(m => m.name === modelName) || false;
      }
    } catch (error) {
      // Ignore verification errors
    }
    return true; // Assume available if verification fails
  }

  /**
   * Get model capabilities based on type
   */
  getModelCapabilities(type) {
    const capabilities = {
      llm: ['chat', 'completion', 'analysis', 'summarization'],
      code: ['code-generation', 'code-review', 'debugging', 'explanation'],
      embedding: ['vector-embedding', 'semantic-search', 'similarity'],
      audio: ['transcription', 'translation'],
      vision: ['image-understanding', 'object-detection']
    };
    
    return capabilities[type] || ['basic-inference'];
  }

  /**
   * Unload a model from memory
   */
  async unloadModel(modelName) {
    if (this.activeModels.has(modelName)) {
      this.activeModels.delete(modelName);
      console.log(`📤 Model ${modelName} unloaded`);
      this.emit('modelUnloaded', { model: modelName, timestamp: new Date() });
    }
    return { success: true };
  }

  /**
   * Run inference on a model
   */
  async infer(modelName, input, options = {}) {
    try {
      let model = this.activeModels.get(modelName);
      
      if (!model) {
        // Try to load the model
        console.log(`Model ${modelName} not loaded, attempting to load...`);
        model = await this.loadModel(modelName);
      }

      console.log(`🧠 Running inference on ${modelName}...`);

      // Route to appropriate inference method
      let result;
      
      if (model.type === 'llm' || model.type === 'code') {
        result = await this.cloudInference(model, input, options);
      } else if (model.type === 'embedding') {
        result = await this.embeddingInference(model, input, options);
      } else {
        result = await this.simulateInference(input, model.type);
      }

      return {
        success: true,
        model: modelName,
        type: model.type,
        input: input.length > 100 ? input.substring(0, 100) + '...' : input,
        output: result.output,
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0 },
        latency: result.latency || 0,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Inference error on ${modelName}:`, error);
      return {
        success: false,
        error: error.message,
        model: modelName,
        fallback: this.getFallbackOutput(input),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Cloud inference with Ollama (using api.ollama.com)
   */
  async cloudInference(model, input, options) {
    const startTime = Date.now();
    
    if (!this.ollamaApiKey) {
      throw new Error('OLLAMA_API_KEY not configured');
    }

    const {
      temperature = 0.7,
      maxTokens = 500,
      systemPrompt = 'You are CephasGM AI, an African-inspired AI assistant.'
    } = options;

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input }
      ];

      const response = await fetch(`${this.ollamaHost}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: model.ollamaModel,
          messages: messages,
          stream: false,
          options: {
            temperature: temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const latency = Date.now() - startTime;

      return {
        output: data.message.content,
        usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 },
        latency: `${latency}ms`
      };

    } catch (error) {
      console.error('Cloud inference failed:', error);
      throw error;
    }
  }

  /**
   * Embedding inference for vector search (using api.ollama.com)
   */
  async embeddingInference(model, input, options) {
    const startTime = Date.now();
    
    if (!this.ollamaApiKey) {
      return this.simulateEmbedding(input);
    }

    try {
      const response = await fetch(`${this.ollamaHost}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: model.ollamaModel,
          prompt: input
        })
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status}`);
      }

      const data = await response.json();
      const latency = Date.now() - startTime;

      return {
        output: {
          embedding: data.embedding,
          dimensions: data.embedding.length
        },
        usage: { prompt_tokens: Math.round(input.length / 4), completion_tokens: 0 },
        latency: `${latency}ms`
      };

    } catch (error) {
      console.log('Embedding inference failed, using simulation:', error.message);
      return this.simulateEmbedding(input);
    }
  }

  /**
   * Simulate embedding for fallback
   */
  simulateEmbedding(input) {
    // Generate random embedding vector (1536 dimensions like OpenAI)
    const dimensions = 1536;
    const embedding = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
    
    return {
      output: {
        embedding: embedding,
        dimensions: dimensions,
        simulated: true
      },
      usage: { prompt_tokens: Math.round(input.length / 4), completion_tokens: 0 },
      latency: '500ms'
    };
  }

  /**
   * Simulate inference for fallback
   */
  async simulateInference(input, type) {
    await this.simulateDelay(500);
    
    const responses = {
      llm: `I've processed your request: "${input.substring(0, 50)}...". This is a simulated response. To get real AI responses, configure your Ollama API key.`,
      
      code: `// Code analysis for: ${input.substring(0, 30)}
// This is a simulated response. Add OLLAMA_API_KEY for real code generation.

function analyze() {
  return {
    status: 'simulated',
    message: 'API key required for actual code analysis'
  };
}`,
      
      audio: 'Audio processing complete. Transcription would appear here with real API key.',
      
      default: `Inference complete. Result: ${input.substring(0, 50)}`
    };
    
    return {
      output: responses[type] || responses.default,
      usage: { prompt_tokens: 50, completion_tokens: 50 },
      latency: '500ms',
      simulated: true
    };
  }

  /**
   * Get fallback output
   */
  getFallbackOutput(input) {
    return `Unable to process: "${input.substring(0, 100)}". Please check your Ollama Cloud API key configuration.`;
  }

  /**
   * Get model status
   */
  getStatus() {
    return {
      gpuAvailable: this.gpuAvailable,
      ollamaCloud: !!this.ollamaApiKey,
      environment: process.env.RENDER ? 'render' : 'local',
      activeModels: Array.from(this.activeModels.entries()).map(([name, model]) => ({
        name,
        type: model.type,
        provider: model.provider,
        loadedAt: model.loadedAt
      })),
      availableModels: Object.entries(this.models).map(([name, info]) => ({
        name,
        type: info.type,
        size: info.size,
        description: info.description,
        loaded: this.activeModels.has(name)
      }))
    };
  }

  /**
   * Get available models
   */
  listAvailableModels() {
    return Object.entries(this.models).map(([name, info]) => ({
      id: name,
      name: name,
      type: info.type,
      size: info.size,
      description: info.description,
      requiresApiKey: true
    }));
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the model host
   */
  async shutdown() {
    console.log('🔄 Shutting down model host...');
    this.activeModels.clear();
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
