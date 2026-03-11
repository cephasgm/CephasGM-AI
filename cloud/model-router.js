/**
 * Model Router
 * Routes requests to appropriate models across the cluster
 */
const local = require("../cluster/worker-node");
const EventEmitter = require('events');

class ModelRouter extends EventEmitter {
  constructor() {
    super();
    
    this.models = new Map();
    this.routingTable = new Map();
    this.modelRegistry = [];
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      requestsByModel: {},
      averageLatency: 0
    };
    
    this.registerDefaultModels();
  }

  /**
   * Register default models
   */
  registerDefaultModels() {
    this.registerModel({
      name: 'llama3',
      type: 'llm',
      size: '8B',
      capabilities: ['chat', 'completion', 'general'],
      provider: 'ollama',
      endpoint: 'local',
      priority: 1
    });

    this.registerModel({
      name: 'mistral',
      type: 'llm',
      size: '7B',
      capabilities: ['chat', 'completion', 'reasoning'],
      provider: 'ollama',
      endpoint: 'local',
      priority: 2
    });

    this.registerModel({
      name: 'codellama',
      type: 'code',
      size: '7B',
      capabilities: ['code-generation', 'completion', 'debugging'],
      provider: 'ollama',
      endpoint: 'local',
      priority: 1
    });

    this.registerModel({
      name: 'phi3',
      type: 'llm',
      size: '3.8B',
      capabilities: ['chat', 'completion', 'fast'],
      provider: 'ollama',
      endpoint: 'local',
      priority: 3
    });
  }

  /**
   * Register a model
   */
  registerModel(modelConfig) {
    this.models.set(modelConfig.name, {
      ...modelConfig,
      registeredAt: new Date().toISOString(),
      health: 'unknown',
      lastUsed: null
    });
    
    this.modelRegistry.push(modelConfig.name);
    
    // Update routing table
    modelConfig.capabilities.forEach(capability => {
      if (!this.routingTable.has(capability)) {
        this.routingTable.set(capability, []);
      }
      this.routingTable.get(capability).push(modelConfig.name);
    });
    
    console.log(`✅ Registered model: ${modelConfig.name}`);
    
    return modelConfig;
  }

  /**
   * Route a prompt to appropriate model
   */
  async route(prompt, options = {}) {
    const {
      model = this.selectBestModel(prompt),
      temperature = 0.7,
      maxTokens = 500,
      stream = false,
      timeout = 30000
    } = options;

    const routingId = this.generateRoutingId();
    const startTime = Date.now();

    console.log(`🔄 [${routingId}] Routing to model: ${model}`);

    // Update metrics
    this.metrics.totalRequests++;
    this.metrics.requestsByModel[model] = (this.metrics.requestsByModel[model] || 0) + 1;

    try {
      // Get model configuration
      const modelConfig = this.models.get(model);
      
      if (!modelConfig) {
        throw new Error(`Model ${model} not found. Available: ${this.modelRegistry.join(', ')}`);
      }

      // Update last used
      modelConfig.lastUsed = new Date().toISOString();

      // Execute with timeout
      const result = await Promise.race([
        this.executeModel(model, prompt, { temperature, maxTokens }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Model timeout after ${timeout}ms`)), timeout)
        )
      ]);

      const latency = Date.now() - startTime;

      // Update metrics
      this.metrics.successfulRequests++;
      this.metrics.averageLatency = (this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency) / this.metrics.successfulRequests;

      this.emit('routingComplete', {
        id: routingId,
        model,
        latency,
        success: true
      });

      return {
        success: true,
        routingId,
        model,
        result,
        latency,
        provider: modelConfig.provider
      };

    } catch (error) {
      console.error(`❌ [${routingId}] Routing failed:`, error.message);
      
      this.metrics.failedRequests++;
      
      this.emit('routingFailed', {
        id: routingId,
        model,
        error: error.message
      });

      // Try fallback model
      if (options.fallback !== false) {
        const fallbackModel = this.getFallbackModel(model);
        if (fallbackModel) {
          console.log(`🔄 [${routingId}] Trying fallback model: ${fallbackModel}`);
          return this.route(prompt, { ...options, model: fallbackModel, fallback: false });
        }
      }

      return {
        success: false,
        routingId,
        error: error.message,
        model
      };
    }
  }

  /**
   * Execute model
   */
  async executeModel(model, prompt, options) {
    const { temperature, maxTokens } = options;

    // Route based on model
    switch (model) {
      case 'llama3':
      case 'mistral':
      case 'codellama':
      case 'phi3':
        return await local.run(prompt, {
          model,
          temperature,
          maxTokens
        });

      default:
        // Try local as fallback
        return await local.run(prompt, {
          model: 'llama3',
          temperature,
          maxTokens
        });
    }
  }

  /**
   * Select best model for the prompt
   */
  selectBestModel(prompt) {
    const promptLower = prompt.toLowerCase();

    // Code-related prompts
    if (promptLower.includes('code') || promptLower.includes('function') || 
        promptLower.includes('program') || promptLower.includes('debug') ||
        promptLower.includes('write a') || promptLower.includes('implement')) {
      return 'codellama';
    }

    // Reasoning/analysis prompts
    if (promptLower.includes('explain') || promptLower.includes('reason') ||
        promptLower.includes('analyze') || promptLower.includes('why')) {
      return 'mistral';
    }

    // Short/fast prompts
    if (prompt.length < 50) {
      return 'phi3';
    }

    // Default to llama3
    return 'llama3';
  }

  /**
   * Get fallback model
   */
  getFallbackModel(originalModel) {
    const fallbacks = {
      'llama3': 'mistral',
      'mistral': 'phi3',
      'codellama': 'llama3',
      'phi3': 'llama3'
    };

    return fallbacks[originalModel];
  }

  /**
   * Batch route multiple prompts
   */
  async batchRoute(prompts, options = {}) {
    const results = await Promise.all(
      prompts.map(prompt => this.route(prompt, options))
    );

    return {
      success: true,
      count: results.length,
      results
    };
  }

  /**
   * Route with retry logic
   */
  async routeWithRetry(prompt, options = {}) {
    const { maxRetries = 3, ...routeOptions } = options;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.route(prompt, routeOptions);
        if (result.success) {
          return result;
        }
      } catch (error) {
        console.log(`Retry ${attempt}/${maxRetries} failed:`, error.message);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Get model information
   */
  getModelInfo(modelName) {
    return this.models.get(modelName);
  }

  /**
   * List all available models
   */
  listModels() {
    return Array.from(this.models.entries()).map(([name, config]) => ({
      name,
      type: config.type,
      size: config.size,
      capabilities: config.capabilities,
      provider: config.provider,
      health: config.health,
      lastUsed: config.lastUsed
    }));
  }

  /**
   * Get models by capability
   */
  getModelsByCapability(capability) {
    const modelNames = this.routingTable.get(capability) || [];
    return modelNames.map(name => this.models.get(name)).filter(Boolean);
  }

  /**
   * Check model health
   */
  async checkHealth(modelName) {
    try {
      const startTime = Date.now();
      const result = await this.route('test', { 
        model: modelName, 
        maxTokens: 10,
        fallback: false
      });
      
      const latency = Date.now() - startTime;
      
      const model = this.models.get(modelName);
      if (model) {
        model.health = result.success ? 'healthy' : 'unhealthy';
        model.latency = latency;
      }
      
      return result.success;
      
    } catch {
      const model = this.models.get(modelName);
      if (model) {
        model.health = 'unhealthy';
      }
      return false;
    }
  }

  /**
   * Check health of all models
   */
  async checkAllHealth() {
    const results = await Promise.all(
      this.modelRegistry.map(model => this.checkHealth(model))
    );
    
    return {
      timestamp: new Date().toISOString(),
      results: this.modelRegistry.map((model, i) => ({
        model,
        healthy: results[i]
      }))
    };
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      ...this.metrics,
      registeredModels: this.modelRegistry.length,
      routingTableSize: this.routingTable.size,
      models: this.listModels(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate routing ID
   */
  generateRoutingId() {
    return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new ModelRouter();
