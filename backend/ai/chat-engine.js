/**
 * AI Chat Engine - Core chat functionality with Ollama Cloud
 */
const fetch = require('node-fetch');
const config = require('../config');

class ChatEngine {
  constructor() {
    this.models = {
      'llama3': { 
        provider: 'ollama', 
        model: 'llama3:8b',
        description: 'Meta Llama 3 8B - Good general purpose'
      },
      'llama3.2': { 
        provider: 'ollama', 
        model: 'llama3.2',
        description: 'Latest Llama 3.2 3B - Fast and efficient'
      },
      'mistral': { 
        provider: 'ollama', 
        model: 'mistral:7b',
        description: 'Mistral 7B - Excellent performance'
      },
      'phi3': { 
        provider: 'ollama', 
        model: 'phi3:3.8b',
        description: 'Phi-3 Mini - Small but powerful'
      },
      'codellama': { 
        provider: 'ollama', 
        model: 'codellama:7b',
        description: 'Code Llama - Specialized for code'
      },
      'neural-chat': { 
        provider: 'ollama', 
        model: 'neural-chat:7b',
        description: 'Neural Chat - Optimized for conversations'
      }
    };
    
    this.conversationHistory = new Map();
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.ollamaHost = 'https://ollama.com';
    
    console.log('🤖 Ollama Cloud initialized');
    console.log(`   API Key: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Available models: ${Object.keys(this.models).length}`);
  }

  /**
   * Send chat message and get response
   */
  async chat(prompt, options = {}) {
    try {
      const {
        model = 'llama3.2',
        temperature = 0.7,
        maxTokens = 2000,
        sessionId = 'default',
        systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant helping users with technology, innovation, and African perspectives.'
      } = options;

      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      if (!this.ollamaApiKey) {
        throw new Error('OLLAMA_API_KEY not configured in environment variables');
      }

      console.log(`💬 Chat request [${model}]: "${prompt.substring(0, 50)}..."`);

      // Get conversation history
      let history = this.getHistory(sessionId);
      
      // Prepare messages array
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: prompt }
      ];

      // Get model configuration
      const modelConfig = this.models[model] || this.models['llama3.2'];

      // Call Ollama Cloud
      const response = await this.callOllamaCloud(modelConfig.model, messages, temperature, maxTokens);

      // Update history
      this.updateHistory(sessionId, prompt, response.content);

      return {
        success: true,
        content: response.content,
        model: model,
        provider: 'ollama-cloud',
        modelUsed: modelConfig.model,
        usage: response.usage || { prompt_tokens: 0, completion_tokens: 0 },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Chat engine error:', error);
      
      // Fallback response with helpful message
      return {
        success: true,
        content: this.getFallbackResponse(prompt, error.message),
        model: options.model || 'llama3.2',
        provider: 'fallback',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Call Ollama Cloud API
   */
  async callOllamaCloud(model, messages, temperature, maxTokens) {
    try {
      console.log(`🌐 Calling Ollama Cloud with model: ${model}`);

      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: false,
          options: {
            temperature: temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Ollama API error response:', errorText);
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      return {
        content: data.message.content,
        usage: data.usage || { prompt_tokens: 0, completion_tokens: 0 }
      };

    } catch (error) {
      console.error('Ollama Cloud call failed:', error);
      throw error;
    }
  }

  /**
   * Get fallback response when Ollama is unavailable
   */
  getFallbackResponse(prompt, errorMsg) {
    const isApiKeyError = errorMsg.includes('API key') || errorMsg.includes('401');
    
    if (isApiKeyError) {
      return `🔑 **API Key Issue Detected**

I notice there's an issue with your Ollama API key. Here's how to fix it:

1. Verify your API key at https://ollama.com/account
2. Check that the key is correctly set in Render environment variables
3. Ensure the key hasn't expired

**Your prompt was:** "${prompt.substring(0, 100)}..."

Once the API key is fixed, I'll be able to provide intelligent responses using Ollama's powerful models!`;
    }

    return `🌐 **Ollama Cloud Connection Issue**

I'm having trouble connecting to Ollama Cloud at the moment. This could be due to:

- Network connectivity issues
- Ollama service temporarily unavailable
- Rate limiting (free tier limits)

**Your question:** "${prompt.substring(0, 100)}..."

Please try again in a few moments. If the issue persists, check your Ollama Cloud dashboard at https://ollama.com for service status.`;
  }

  /**
   * Stream chat response (for real-time applications)
   */
  async *stream(prompt, options = {}) {
    const result = await this.chat(prompt, options);
    
    const words = result.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      yield JSON.stringify({
        id: Date.now(),
        choices: [{
          delta: { content: words[i] + (i < words.length - 1 ? ' ' : '') },
          index: 0
        }]
      });
      await this.simulateDelay(30);
    }
  }

  /**
   * Get conversation history
   */
  getHistory(sessionId) {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    
    const history = this.conversationHistory.get(sessionId);
    return history.slice(-6); // Last 6 messages (3 exchanges) for context
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
    
    // Keep last 20 messages (10 exchanges)
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }
    
    this.conversationHistory.set(sessionId, history);
  }

  /**
   * Clear conversation history
   */
  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
    return { success: true, message: 'History cleared' };
  }

  /**
   * Get available models
   */
  getModels() {
    return Object.entries(this.models).map(([name, config]) => ({
      id: name,
      name: name,
      fullName: config.model,
      provider: config.provider,
      description: config.description
    }));
  }

  /**
   * Test Ollama connection
   */
  async testConnection() {
    try {
      const response = await fetch('https://ollama.com/api/models', {
        headers: {
          'Authorization': `Bearer ${this.ollamaApiKey}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          message: '✅ Ollama Cloud connected successfully',
          models: data.models || []
        };
      } else {
        return {
          success: false,
          message: `❌ Connection failed: ${response.status}`,
          error: await response.text()
        };
      }
    } catch (error) {
      return {
        success: false,
        message: '❌ Connection error',
        error: error.message
      };
    }
  }

  /**
   * Simulate delay for streaming
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ChatEngine();
