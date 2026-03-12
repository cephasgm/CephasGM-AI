/**
 * Multimodal Text Engine - Text generation and processing
 * Now fully integrated with Ollama Cloud for all text operations
 */
const fetch = require('node-fetch');
const EventEmitter = require('events');

class TextEngine extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'llama3.2': { 
        provider: 'ollama', 
        model: 'llama3.2:3b',
        context: 8192,
        description: 'Meta Llama 3.2 3B - Fast, efficient, great for general use'
      },
      'llama3': { 
        provider: 'ollama', 
        model: 'llama3:8b',
        context: 8192,
        description: 'Meta Llama 3 8B - Powerful general purpose'
      },
      'mistral': { 
        provider: 'ollama', 
        model: 'mistral:7b',
        context: 8192,
        description: 'Mistral 7B - Excellent performance and reasoning'
      },
      'phi3': { 
        provider: 'ollama', 
        model: 'phi3:3.8b',
        context: 4096,
        description: 'Phi-3 Mini - Small but powerful'
      },
      'neural-chat': { 
        provider: 'ollama', 
        model: 'neural-chat:7b',
        context: 8192,
        description: 'Neural Chat - Optimized for conversations'
      },
      'codellama': { 
        provider: 'ollama', 
        model: 'codellama:7b',
        context: 16384,
        description: 'Code Llama - Specialized for programming'
      },
      'dolphin-mixtral': { 
        provider: 'ollama', 
        model: 'dolphin-mixtral:8x7b',
        context: 32768,
        description: 'Dolphin Mixtral - Uncensored, creative'
      }
    };
    
    this.cache = new Map();
    this.stats = {
      generations: 0,
      tokens: 0,
      failures: 0,
      totalLatency: 0
    };
    
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    
    console.log('📝 Text engine initialized with Ollama Cloud');
    console.log(`   API Key: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Models: ${Object.keys(this.models).length}`);
  }

  /**
   * Generate text from prompt with full AI capabilities
   */
  async generate(prompt, options = {}) {
    const {
      model = 'llama3.2',
      temperature = 0.7,
      maxTokens = 1000,
      systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant helping users with technology, innovation, and African perspectives.',
      useCache = false,
      stream = false,
      format = null
    } = options;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    console.log(`📝 [${requestId}] Generating with ${model}: "${prompt.substring(0, 50)}..."`);

    // Check cache
    const cacheKey = `${model}:${prompt}`;
    if (useCache && this.cache.has(cacheKey)) {
      console.log('📦 Using cached result');
      const cached = this.cache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < 3600000) { // 1 hour
        return cached.data;
      }
    }

    try {
      let result;

      if (this.ollamaApiKey) {
        result = await this.callOllamaCloud(prompt, model, temperature, maxTokens, systemPrompt, format);
      } else {
        result = await this.simulateGeneration(prompt, model);
      }

      const latency = Date.now() - startTime;

      // Update stats
      this.stats.generations++;
      this.stats.tokens += result.usage?.totalTokens || 100;
      this.stats.totalLatency += latency;

      const response = {
        success: true,
        requestId,
        text: result.text,
        model,
        provider: this.ollamaApiKey ? 'ollama-cloud' : 'simulated',
        usage: result.usage || { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        latency,
        timestamp: new Date().toISOString()
      };

      // Cache if requested
      if (useCache) {
        this.cache.set(cacheKey, {
          data: response,
          timestamp: Date.now()
        });
      }

      this.emit('generationComplete', { requestId, model, latency });

      return response;

    } catch (error) {
      console.error('Text generation failed:', error);
      this.stats.failures++;

      const isApiKeyError = error.message.includes('API key') || error.message.includes('401');
      
      return {
        success: false,
        requestId,
        error: error.message,
        fallback: this.getFallbackText(prompt, isApiKeyError),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Call Ollama Cloud API
   */
  async callOllamaCloud(prompt, model, temperature, maxTokens, systemPrompt, format) {
    const modelConfig = this.models[model] || this.models['llama3.2'];
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    const requestBody = {
      model: modelConfig.model,
      messages: messages,
      stream: false,
      options: {
        temperature: temperature,
        num_predict: maxTokens
      }
    };

    // Add JSON format if requested
    if (format === 'json') {
      requestBody.format = 'json';
    }

    const response = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ollamaApiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    return {
      text: data.message.content,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: data.message.content.length / 4,
        totalTokens: (prompt.length + data.message.content.length) / 4
      }
    };
  }

  /**
   * Stream text generation
   */
  async *stream(prompt, options = {}) {
    const result = await this.generate(prompt, options);
    
    if (!result.success) {
      yield JSON.stringify({ error: result.error });
      return;
    }

    const words = result.text.split(' ');
    const chunkSize = 3; // Send 3 words at a time

    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize).join(' ');
      
      yield JSON.stringify({
        id: result.requestId,
        choices: [{
          delta: { content: chunk + (i + chunkSize < words.length ? ' ' : '') },
          index: 0,
          finish_reason: i + chunkSize >= words.length ? 'stop' : null
        }]
      });
      
      await this.simulateDelay(30);
    }
  }

  /**
   * Generate multiple variations with different temperatures
   */
  async generateVariations(prompt, count = 3, options = {}) {
    const variations = [];
    const startTime = Date.now();

    for (let i = 0; i < count; i++) {
      const temperature = 0.5 + (i * 0.2); // 0.5, 0.7, 0.9, etc.
      
      const result = await this.generate(prompt, {
        ...options,
        temperature: Math.min(temperature, 1.0),
        useCache: false
      });
      
      variations.push(result);
    }

    return {
      success: true,
      count: variations.length,
      variations,
      batchId: this.generateRequestId(),
      timestamp: new Date().toISOString(),
      latency: Date.now() - startTime
    };
  }

  /**
   * Summarize text with AI
   */
  async summarize(text, maxLength = 200, options = {}) {
    const prompt = `Summarize the following text in ${maxLength} words or less, capturing the key points:\n\n${text}`;
    
    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.5,
      maxTokens: maxLength * 2,
      ...options
    });
    
    return {
      success: result.success,
      summary: result.text,
      originalLength: text.length,
      summarizedLength: result.text.length,
      compression: ((1 - result.text.length / text.length) * 100).toFixed(1) + '%',
      model: result.model,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Translate text to target language
   */
  async translate(text, targetLanguage, options = {}) {
    const prompt = `Translate the following text to ${targetLanguage}. Maintain the original meaning, tone, and style:\n\n${text}`;
    
    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.3,
      ...options
    });
    
    return {
      success: result.success,
      originalText: text,
      translatedText: result.text,
      targetLanguage,
      model: result.model,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze sentiment of text
   */
  async analyzeSentiment(text) {
    const prompt = `Analyze the sentiment of this text. Return a JSON with: sentiment (positive/negative/neutral), confidence (0-1), and key emotional words:\n\n${text}`;
    
    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.2,
      format: 'json'
    });
    
    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }

    try {
      const parsed = JSON.parse(result.text);
      return {
        success: true,
        ...parsed,
        timestamp: new Date().toISOString()
      };
    } catch {
      return {
        success: true,
        sentiment: 'neutral',
        confidence: 0.5,
        analysis: result.text,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Extract key information from text
   */
  async extractInfo(text, infoTypes = ['dates', 'names', 'locations', 'organizations']) {
    const prompt = `Extract the following information from the text: ${infoTypes.join(', ')}.\n\nReturn as a structured JSON object.\n\nText: ${text}`;
    
    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.2,
      format: 'json'
    });
    
    if (!result.success) {
      return {
        success: false,
        error: result.error
      };
    }

    try {
      const parsed = JSON.parse(result.text);
      return {
        success: true,
        extracted: parsed,
        timestamp: new Date().toISOString()
      };
    } catch {
      return {
        success: true,
        extracted: { raw: result.text },
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Generate creative writing (stories, poems, etc.)
   */
  async creativeWrite(prompt, genre = 'story', options = {}) {
    const systemPrompts = {
      story: 'You are a creative storyteller. Write engaging narratives with vivid descriptions and compelling characters.',
      poem: 'You are a poet. Write expressive poems with rhythm and imagery.',
      script: 'You are a screenwriter. Write dialogue and scenes in proper script format.',
      essay: 'You are an essayist. Write thoughtful, well-structured essays on the given topic.'
    };

    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.8,
      systemPrompt: systemPrompts[genre] || systemPrompts.story,
      ...options
    });

    return {
      success: result.success,
      genre,
      content: result.text,
      model: result.model,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Answer questions with sources
   */
  async qaWithSources(question, context) {
    const prompt = `Answer the question based on the provided context. Include relevant quotes from the context as sources.\n\nContext: ${context}\n\nQuestion: ${question}`;
    
    const result = await this.generate(prompt, {
      model: 'llama3.2',
      temperature: 0.4,
      maxTokens: 800
    });

    return {
      success: result.success,
      answer: result.text,
      hasContext: !!context,
      model: result.model,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Simulate text generation for fallback
   */
  async simulateGeneration(prompt, model) {
    await this.simulateDelay(1000);

    const responses = [
      `Based on your request about "${prompt.substring(0, 50)}", I can provide the following insights...\n\nThis is simulated text generation. To get real AI-generated content, add your Ollama Cloud API key to the environment variables.`,
      
      `I understand you're asking about "${prompt.substring(0, 40)}". This relates to several important concepts in AI and technology.\n\nCurrently running in demo mode. Configure OLLAMA_API_KEY to get production-quality responses from models like ${model}.`,
      
      `Thanks for your question. With Ollama Cloud configured, I could provide a detailed response using the ${model} model. For now, this is a placeholder response.\n\nTo enable full capabilities:\n1. Get an API key from ollama.com\n2. Add it to your Render environment\n3. Redeploy the application`
    ];

    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      usage: {
        promptTokens: Math.round(prompt.length / 4),
        completionTokens: 150,
        totalTokens: Math.round(prompt.length / 4) + 150
      }
    };
  }

  /**
   * Get fallback text
   */
  getFallbackText(prompt, isApiKeyError) {
    if (isApiKeyError) {
      return `🔑 **API Key Required**

To use the text generation engine with full AI capabilities, please configure your Ollama Cloud API key:

1. Get your API key from https://ollama.com/account
2. Add it to your Render environment variables as OLLAMA_API_KEY
3. Redeploy the application

**Your prompt was:** "${prompt.substring(0, 100)}..."

Once configured, you'll have access to multiple models including Llama 3.2, Mistral, and CodeLlama.`;
    }

    return `I apologize, but I encountered an error processing your request about "${prompt.substring(0, 100)}". Please try again or check your API configuration.`;
  }

  /**
   * Compare responses from different models
   */
  async compareModels(prompt, models = ['llama3.2', 'mistral', 'phi3']) {
    const results = [];

    for (const model of models) {
      const result = await this.generate(prompt, { model, useCache: false });
      results.push({
        model,
        response: result.text,
        latency: result.latency,
        success: result.success
      });
    }

    return {
      success: true,
      prompt,
      results,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get available models with details
   */
  getModels() {
    return Object.entries(this.models).map(([id, info]) => ({
      id,
      name: id,
      provider: info.provider,
      modelName: info.model,
      contextSize: info.context,
      description: info.description
    }));
  }

  /**
   * Get engine stats
   */
  getStats() {
    return {
      ...this.stats,
      averageLatency: this.stats.generations > 0 
        ? (this.stats.totalLatency / this.stats.generations).toFixed(0) + 'ms'
        : '0ms',
      cacheSize: this.cache.size,
      modelsAvailable: Object.keys(this.models).length,
      apiKeyConfigured: !!this.ollamaApiKey
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Text engine cache cleared');
    return { success: true, message: 'Cache cleared' };
  }

  /**
   * Generate request ID
   */
  generateRequestId() {
    return `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new TextEngine();
