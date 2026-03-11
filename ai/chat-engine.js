/**
 * AI Chat Engine - Core chat functionality with multiple model support
 */
const fetch = require('node-fetch');
const config = require('../config');

class ChatEngine {
  constructor() {
    this.models = {
      'gpt-4': { provider: 'openai', context: 8192 },
      'gpt-3.5-turbo': { provider: 'openai', context: 4096 },
      'claude': { provider: 'anthropic', context: 100000 },
      'llama3': { provider: 'local', context: 8192 }
    };
    
    this.conversationHistory = new Map();
  }

  /**
   * Send chat message and get response
   */
  async chat(prompt, options = {}) {
    try {
      const {
        model = 'gpt-3.5-turbo',
        temperature = 0.7,
        maxTokens = 500,
        sessionId = 'default',
        systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant.'
      } = options;

      // Validate input
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      console.log(`Chat request [${model}]: "${prompt.substring(0, 50)}..."`);

      // Get conversation history
      let history = this.getHistory(sessionId);
      
      // Prepare messages
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: prompt }
      ];

      // Route to appropriate model
      let response;
      const modelConfig = this.models[model] || this.models['gpt-3.5-turbo'];

      switch (modelConfig.provider) {
        case 'openai':
          response = await this.callOpenAI(messages, model, temperature, maxTokens);
          break;
        case 'local':
          response = await this.callLocalModel(prompt, model);
          break;
        default:
          response = await this.callOpenAI(messages, 'gpt-3.5-turbo', temperature, maxTokens);
      }

      // Update history
      this.updateHistory(sessionId, prompt, response.content);

      return {
        success: true,
        content: response.content,
        model: model,
        usage: response.usage || { prompt_tokens: 0, completion_tokens: 0 },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Chat engine error:', error);
      return {
        success: false,
        error: error.message,
        content: 'I apologize, but I encountered an error. Please try again.',
        fallback: true
      };
    }
  }

  /**
   * Call OpenAI API
   */
  async callOpenAI(messages, model, temperature, maxTokens) {
    const apiKey = config.openaiApiKey;
    
    if (!apiKey || apiKey === 'YOUR_OPENAI_API_KEY') {
      // Demo mode - return mock response
      return {
        content: this.getMockResponse(messages[messages.length - 1].content),
        usage: { prompt_tokens: 50, completion_tokens: 100 }
      };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
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
      content: data.choices[0].message.content,
      usage: data.usage
    };
  }

  /**
   * Call local model (Ollama)
   */
  async callLocalModel(prompt, model) {
    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.replace('llama3', 'llama3'),
          prompt: prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error('Local model unavailable');
      }

      const data = await response.json();
      
      return {
        content: data.response,
        usage: { prompt_tokens: 0, completion_tokens: 0 }
      };
    } catch (error) {
      console.log('Local model failed, using mock:', error.message);
      return {
        content: this.getMockResponse(prompt),
        usage: { prompt_tokens: 0, completion_tokens: 0 }
      };
    }
  }

  /**
   * Get mock response for demo
   */
  getMockResponse(prompt) {
    const responses = [
      `I understand you're asking about "${prompt.substring(0, 50)}". As CephasGM AI, I'm here to help with African perspectives on technology and innovation.`,
      `That's an interesting question about ${prompt.substring(0, 30)}. Let me share some insights from an African context.`,
      `Great question! From my African-inspired perspective, ${prompt.substring(0, 40)} has significant potential for innovation on the continent.`,
      `I appreciate your curiosity about ${prompt.substring(0, 40)}. This connects to broader themes of technological advancement in Africa.`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Get conversation history
   */
  getHistory(sessionId) {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    
    const history = this.conversationHistory.get(sessionId);
    
    // Return last 10 messages for context
    return history.slice(-10);
  }

  /**
   * Update conversation history
   */
  updateHistory(sessionId, userMessage, aiResponse) {
    const history = this.conversationHistory.get(sessionId) || [];
    
    history.push(
      { role: 'user', content: userMessage },
      { role: 'assistant', content: aiResponse }
    );
    
    // Keep last 50 messages
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }
    
    this.conversationHistory.set(sessionId, history);
  }

  /**
   * Clear conversation history
   */
  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
  }

  /**
   * Get available models
   */
  getModels() {
    return Object.entries(this.models).map(([name, config]) => ({
      name,
      provider: config.provider,
      contextSize: config.context
    }));
  }
}

module.exports = new ChatEngine();
