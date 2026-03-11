/**
 * Text Engine - Generate and process text
 */
const fetch = require("node-fetch");

class TextEngine {
  constructor() {
    this.models = {
      'gpt-4': { provider: 'openai', context: 8192 },
      'gpt-3.5-turbo': { provider: 'openai', context: 4096 },
      'claude': { provider: 'anthropic', context: 100000 }
    };
    
    this.cache = new Map();
    this.stats = {
      generations: 0,
      tokens: 0,
      failures: 0
    };
  }

  /**
   * Generate text from prompt
   */
  async generate(prompt, options = {}) {
    const {
      model = 'gpt-3.5-turbo',
      temperature = 0.7,
      maxTokens = 500,
      systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence.'
    } = options;

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    console.log(`📝 Text engine generating with ${model}: "${prompt.substring(0, 50)}..."`);

    // Check cache for identical prompts (optional)
    const cacheKey = `${model}:${prompt}`;
    if (options.useCache && this.cache.has(cacheKey)) {
      console.log('📦 Using cached result');
      return this.cache.get(cacheKey);
    }

    try {
      const apiKey = process.env.OPENAI_KEY;
      
      let result;
      
      if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
        result = await this.callOpenAI(prompt, model, temperature, maxTokens, systemPrompt);
      } else {
        result = await this.simulateGeneration(prompt, model);
      }

      // Update stats
      this.stats.generations++;
      this.stats.tokens += result.tokens || 0;

      // Cache if requested
      if (options.useCache) {
        this.cache.set(cacheKey, result);
      }

      return result;

    } catch (error) {
      console.error('Text generation failed:', error);
      this.stats.failures++;
      
      return {
        success: false,
        error: error.message,
        text: this.getFallbackText(prompt)
      };
    }
  }

  /**
   * Call OpenAI API
   */
  async callOpenAI(prompt, model, temperature, maxTokens, systemPrompt) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.OPENAI_KEY
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: temperature,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      text: data.choices[0].message.content,
      model: model,
      tokens: data.usage?.total_tokens || 0,
      finishReason: data.choices[0].finish_reason
    };
  }

  /**
   * Simulate text generation for demo
   */
  async simulateGeneration(prompt, model) {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + prompt.length * 2));
    
    const responses = [
      `Based on your request about "${prompt.substring(0, 50)}", I can provide the following insights from an African perspective...\n\nThis is simulated text generation. In production with a real API key, you would get actual AI-generated content.`,
      
      `I understand you're asking about "${prompt.substring(0, 40)}". This relates to several important concepts in AI and technology across Africa.\n\nTo enable real AI responses, set your OPENAI_KEY environment variable.`,
      
      `Thanks for your question! ${prompt.substring(0, 60)}...\n\nCurrently running in demo mode. Add your OpenAI API key to get production-quality responses.`
    ];
    
    return {
      success: true,
      text: responses[Math.floor(Math.random() * responses.length)],
      model: model + ' (simulated)',
      tokens: Math.round(prompt.length / 4),
      simulated: true
    };
  }

  /**
   * Get fallback text on error
   */
  getFallbackText(prompt) {
    return `I apologize, but I encountered an error processing your request about "${prompt.substring(0, 100)}". Please try again or check your API configuration.`;
  }

  /**
   * Generate multiple variations
   */
  async generateVariations(prompt, count = 3, options = {}) {
    const variations = [];
    
    for (let i = 0; i < count; i++) {
      const result = await this.generate(prompt, {
        ...options,
        temperature: 0.8 + (i * 0.1) // Slightly different each time
      });
      variations.push(result);
    }
    
    return variations;
  }

  /**
   * Analyze sentiment of text
   */
  async analyzeSentiment(text) {
    const prompt = `Analyze the sentiment of this text and return only a JSON object with sentiment (positive/negative/neutral), confidence (0-1), and key words:\n\n${text}`;
    
    const result = await this.generate(prompt, { temperature: 0.3 });
    
    try {
      // Try to parse JSON from response
      const jsonMatch = result.text.match(/\{.*\}/s);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fallback
    }
    
    return {
      sentiment: 'neutral',
      confidence: 0.5,
      keyWords: text.split(' ').slice(0, 5)
    };
  }

  /**
   * Summarize long text
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
   * Get engine statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.cache.size
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
   * Stream generation (for real-time)
   */
  async *stream(prompt, options = {}) {
    // In a real implementation, this would use streaming API
    // For demo, we'll simulate streaming by yielding chunks
    const result = await this.generate(prompt, options);
    const words = result.text.split(' ');
    
    for (let i = 0; i < words.length; i++) {
      yield words[i] + (i < words.length - 1 ? ' ' : '');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

module.exports = new TextEngine();
