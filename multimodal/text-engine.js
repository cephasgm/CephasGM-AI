/**
 * Multimodal Text Engine - Text generation and processing
 * Supports multiple models and streaming
 */
const fetch = require('node-fetch');
const EventEmitter = require('events');

class TextEngine extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'gpt-4': { provider: 'openai', context: 8192 },
      'gpt-3.5-turbo': { provider: 'openai', context: 4096 },
      'llama3': { provider: 'local', context: 8192 },
      'claude': { provider: 'anthropic', context: 100000 }
    };
    
    this.cache = new Map();
    this.stats = {
      generations: 0,
      tokens: 0,
      failures: 0
    };
    
    console.log('📝 Text engine initialized');
  }

  /**
   * Generate text from prompt
   */
  async generate(prompt, options = {}) {
    const {
      model = 'gpt-3.5-turbo',
      temperature = 0.7,
      maxTokens = 500,
      systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence.',
      useCache = false
    } = options;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    console.log(`📝 [${requestId}] Generating with ${model}: "${prompt.substring(0, 50)}..."`);

    // Check cache
    const cacheKey = `${model}:${prompt}`;
    if (useCache && this.cache.has(cacheKey)) {
      console.log('📦 Using cached result');
      return this.cache.get(cacheKey);
    }

    try {
      let result;

      if (this.models[model]?.provider === 'openai') {
        result = await this.callOpenAI(prompt, model, temperature, maxTokens, systemPrompt);
      } else {
        result = await this.simulateGeneration(prompt, model);
      }

      const latency = Date.now() - startTime;

      // Update stats
      this.stats.generations++;
      this.stats.tokens += result.usage?.totalTokens || 100;

      const response = {
        success: true,
        requestId,
        text: result.text,
        model,
        usage: result.usage || { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        latency,
        timestamp: new Date().toISOString()
      };

      // Cache if requested
      if (useCache) {
        this.cache.set(cacheKey, response);
      }

      this.emit('generationComplete', { requestId, model, latency });

      return response;

    } catch (error) {
      console.error('Text generation failed:', error);
      this.stats.failures++;

      return {
        success: false,
        requestId,
        error: error.message,
        fallback: this.getFallbackText(prompt)
      };
    }
  }

  /**
   * Call OpenAI API
   */
  async callOpenAI(prompt, model, temperature, maxTokens, systemPrompt) {
    const apiKey = process.env.OPENAI_KEY;

    if (!apiKey || apiKey === 'YOUR_OPENAI_KEY') {
      return this.simulateGeneration(prompt, model);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();

    return {
      text: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      }
    };
  }

  /**
   * Simulate text generation
   */
  async simulateGeneration(prompt, model) {
    await this.simulateDelay(1000);

    const responses = [
      `Based on your request about "${prompt.substring(0, 50)}", I can provide the following insights...\n\nThis is simulated text generation. In production with a real API key, you would get actual AI-generated content.`,
      
      `I understand you're asking about "${prompt.substring(0, 40)}". This relates to several important concepts in AI and technology.\n\nCurrently running in demo mode. Add your OpenAI API key to get production-quality responses.`
    ];

    return {
      text: responses[Math.floor(Math.random() * responses.length)],
      usage: {
        promptTokens: Math.round(prompt.length / 4),
        completionTokens: 100,
        totalTokens: Math.round(prompt.length / 4) + 100
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
      
      await this.simulateDelay(50);
    }
  }

  /**
   * Generate multiple variations
   */
  async generateVariations(prompt, count = 3, options = {}) {
    const variations = [];

    for (let i = 0; i < count; i++) {
      const result = await this.generate(prompt, {
        ...options,
        temperature: 0.8 + (i * 0.1)
      });
      variations.push(result);
    }

    return variations;
  }

  /**
   * Summarize text
   */
  async summarize(text, maxLength = 200) {
    const prompt = `Summarize the following text in ${maxLength} words or less:\n\n${text}`;
    
    const result = await this.generate(prompt, { temperature: 0.5 });
    
    return {
      summary: result.text,
      originalLength: text.length,
      summarizedLength: result.text.length
    };
  }

  /**
   * Translate text
   */
  async translate(text, targetLanguage) {
    const prompt = `Translate the following text to ${targetLanguage}:\n\n${text}`;
    
    return this.generate(prompt, { temperature: 0.3 });
  }

  /**
   * Get fallback text
   */
  getFallbackText(prompt) {
    return `I apologize, but I encountered an error processing your request about "${prompt.substring(0, 100)}". Please try again or check your API configuration.`;
  }

  /**
   * Get available models
   */
  getModels() {
    return Object.keys(this.models).map(name => ({
      name,
      provider: this.models[name].provider,
      contextSize: this.models[name].context
    }));
  }

  /**
   * Get engine stats
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size,
      models: this.getModels().length
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Text engine cache cleared');
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
