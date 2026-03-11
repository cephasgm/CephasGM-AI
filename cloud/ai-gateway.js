/**
 * AI Cloud Gateway
 * Central entry point for all AI requests with routing, load balancing, and monitoring
 */
const EventEmitter = require('events');
const router = require("./model-router");
const orchestrator = require("../platform/orchestrator");
const crypto = require('crypto');

class AIGateway extends EventEmitter {
  constructor() {
    super();
    
    this.endpoints = new Map();
    this.apiKeys = new Map();
    this.rateLimits = new Map();
    this.requestLogs = [];
    
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      requestsByModel: {},
      requestsByEndpoint: {}
    };

    this.setupDefaultEndpoints();
    console.log('🌐 AI Gateway initialized');
  }

  /**
   * Setup default API endpoints
   */
  setupDefaultEndpoints() {
    this.registerEndpoint('/v1/chat', {
      model: 'gpt-3.5-turbo',
      timeout: 30000,
      handler: this.handleChat.bind(this)
    });

    this.registerEndpoint('/v1/completions', {
      model: 'gpt-3.5-turbo',
      timeout: 30000,
      handler: this.handleCompletions.bind(this)
    });

    this.registerEndpoint('/v1/embeddings', {
      model: 'text-embedding-ada-002',
      timeout: 10000,
      handler: this.handleEmbeddings.bind(this)
    });
  }

  /**
   * Register an API endpoint
   */
  registerEndpoint(path, config) {
    this.endpoints.set(path, {
      ...config,
      registeredAt: new Date().toISOString()
    });
    
    console.log(`✅ Registered endpoint: ${path}`);
  }

  /**
   * Register an API key
   */
  registerApiKey(key, config = {}) {
    const hashedKey = this.hashKey(key);
    
    this.apiKeys.set(hashedKey, {
      key: hashedKey,
      name: config.name || 'default',
      rateLimit: config.rateLimit || 1000, // requests per hour
      createdAt: new Date().toISOString(),
      lastUsed: null
    });

    return hashedKey;
  }

  /**
   * Make a request to the AI gateway
   */
  async request(prompt, options = {}) {
    const {
      model = 'gpt-3.5-turbo',
      endpoint = '/v1/chat',
      temperature = 0.7,
      maxTokens = 500,
      apiKey = 'default',
      timeout = 30000
    } = options;

    const requestId = this.generateRequestId();
    const startTime = Date.now();

    console.log(`🌐 [${requestId}] AI Gateway request: ${endpoint}`);

    // Track metrics
    this.metrics.totalRequests++;
    this.metrics.requestsByEndpoint[endpoint] = (this.metrics.requestsByEndpoint[endpoint] || 0) + 1;
    this.metrics.requestsByModel[model] = (this.metrics.requestsByModel[model] || 0) + 1;

    try {
      // Check API key
      if (!this.validateApiKey(apiKey)) {
        throw new Error('Invalid API key');
      }

      // Check rate limit
      if (!this.checkRateLimit(apiKey)) {
        throw new Error('Rate limit exceeded');
      }

      // Get endpoint handler
      const endpointConfig = this.endpoints.get(endpoint);
      if (!endpointConfig) {
        throw new Error(`Endpoint ${endpoint} not found`);
      }

      // Execute with timeout
      const result = await Promise.race([
        endpointConfig.handler(prompt, { ...options, model, temperature, maxTokens }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Request timeout after ${timeout}ms`)), timeout)
        )
      ]);

      const latency = Date.now() - startTime;

      // Update metrics
      this.metrics.successfulRequests++;
      this.metrics.averageLatency = (this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency) / this.metrics.successfulRequests;

      // Log request
      this.logRequest({
        id: requestId,
        endpoint,
        model,
        prompt: prompt.substring(0, 100),
        latency,
        success: true,
        timestamp: new Date().toISOString()
      });

      this.emit('requestSucceeded', { requestId, endpoint, latency });

      return {
        success: true,
        requestId,
        ...result,
        latency
      };

    } catch (error) {
      this.metrics.failedRequests++;

      this.logRequest({
        id: requestId,
        endpoint,
        model,
        prompt: prompt.substring(0, 100),
        error: error.message,
        success: false,
        timestamp: new Date().toISOString()
      });

      this.emit('requestFailed', { requestId, endpoint, error: error.message });

      return {
        success: false,
        requestId,
        error: error.message
      };
    }
  }

  /**
   * Handle chat completions
   */
  async handleChat(prompt, options) {
    // Route through model router
    const result = await router.route(prompt, options);
    
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: result.result || result
        },
        index: 0
      }],
      usage: {
        prompt_tokens: Math.round(prompt.length / 4),
        completion_tokens: Math.round((result.result || '').length / 4),
        total_tokens: Math.round((prompt.length + (result.result || '').length) / 4)
      }
    };
  }

  /**
   * Handle text completions
   */
  async handleCompletions(prompt, options) {
    const result = await router.route(prompt, options);
    
    return {
      choices: [{
        text: result.result || result,
        index: 0
      }],
      usage: {
        prompt_tokens: Math.round(prompt.length / 4),
        completion_tokens: Math.round((result.result || '').length / 4),
        total_tokens: Math.round((prompt.length + (result.result || '').length) / 4)
      }
    };
  }

  /**
   * Handle embeddings
   */
  async handleEmbeddings(text, options) {
    // Simulate embeddings
    const dimensions = 1536;
    const embedding = Array(dimensions).fill(0).map(() => Math.random() * 2 - 1);
    
    return {
      data: [{
        embedding,
        index: 0
      }],
      usage: {
        prompt_tokens: Math.round(text.length / 4),
        total_tokens: Math.round(text.length / 4)
      }
    };
  }

  /**
   * Stream a response (for real-time applications)
   */
  async *stream(prompt, options = {}) {
    const result = await this.request(prompt, options);
    
    if (!result.success) {
      yield JSON.stringify({ error: result.error });
      return;
    }

    const text = result.choices?.[0]?.message?.content || result.result;
    const words = text.split(' ');

    for (let i = 0; i < words.length; i++) {
      yield JSON.stringify({
        id: result.requestId,
        choices: [{
          delta: {
            content: words[i] + (i < words.length - 1 ? ' ' : '')
          },
          index: 0
        }]
      });
      
      await this.sleep(50);
    }
  }

  /**
   * Validate API key
   */
  validateApiKey(key) {
    if (key === 'default') return true; // Allow default for demo
    
    const hashedKey = this.hashKey(key);
    return this.apiKeys.has(hashedKey);
  }

  /**
   * Check rate limit for API key
   */
  checkRateLimit(key) {
    const now = Date.now();
    const hour = 60 * 60 * 1000;
    
    const limits = this.rateLimits.get(key) || {
      count: 0,
      resetTime: now + hour
    };

    if (now > limits.resetTime) {
      limits.count = 0;
      limits.resetTime = now + hour;
    }

    limits.count++;
    this.rateLimits.set(key, limits);

    const apiKeyConfig = this.apiKeys.get(this.hashKey(key));
    return limits.count <= (apiKeyConfig?.rateLimit || 1000);
  }

  /**
   * Log request for monitoring
   */
  logRequest(request) {
    this.requestLogs.push(request);
    
    // Keep only last 1000 logs
    if (this.requestLogs.length > 1000) {
      this.requestLogs = this.requestLogs.slice(-1000);
    }
  }

  /**
   * Get gateway metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - (this.startTime || Date.now()),
      activeEndpoints: this.endpoints.size,
      registeredKeys: this.apiKeys.size,
      recentRequests: this.requestLogs.slice(-10)
    };
  }

  /**
   * Get endpoint status
   */
  getEndpointStatus(path) {
    return this.endpoints.get(path);
  }

  /**
   * Generate request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Hash API key
   */
  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AIGateway();
