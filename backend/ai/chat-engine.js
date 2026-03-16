/**
 * AI Chat Engine - Core chat functionality with OpenAI, Ollama, and DeepSeek
 * Enhanced with streaming support and robust error handling
 */
const fetch = require('node-fetch');
const config = require('../config');

class ChatEngine {
  constructor() {
    this.models = {
      // OpenAI models
      'gpt-4': { 
        provider: 'openai', 
        model: 'gpt-4',
        description: 'OpenAI GPT-4 - Most powerful'
      },
      'gpt-4-turbo': { 
        provider: 'openai', 
        model: 'gpt-4-turbo-preview',
        description: 'OpenAI GPT-4 Turbo - Fast and powerful'
      },
      'gpt-3.5-turbo': { 
        provider: 'openai', 
        model: 'gpt-3.5-turbo',
        description: 'OpenAI GPT-3.5 Turbo - Fast, efficient'
      },
      // Ollama models (fallback)
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
      },
      // DeepSeek model
      'deepseek-chat': { 
        provider: 'deepseek', 
        model: 'deepseek-chat',
        description: 'DeepSeek Chat - Competitive alternative'
      }
    };
    
    this.conversationHistory = new Map();
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    this.ollamaHost = 'https://api.ollama.com';
    
    console.log('🤖 Chat engine initialized');
    console.log(`   OpenAI: ${this.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   DeepSeek: ${this.deepseekApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Available models: ${Object.keys(this.models).length}`);
    
    // Test connection on startup
    if (this.ollamaApiKey) {
      this.testOllamaConnection().catch(() => {});
    }
  }

  /**
   * Send chat message and get response (non-streaming)
   */
  async chat(prompt, options = {}) {
    try {
      const {
        model = 'gpt-3.5-turbo',
        temperature = 0.7,
        maxTokens = 2000,
        sessionId = 'default',
        systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant helping users with technology, innovation, and African perspectives.'
      } = options;

      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
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
      const modelConfig = this.models[model] || this.models['gpt-3.5-turbo'];

      // Call appropriate provider
      let response;
      if (modelConfig.provider === 'openai' && this.openaiApiKey) {
        response = await this.callOpenAI(modelConfig.model, messages, temperature, maxTokens);
      } else if (modelConfig.provider === 'deepseek' && this.deepseekApiKey) {
        response = await this.callDeepSeek(modelConfig.model, messages, temperature, maxTokens);
      } else if (this.ollamaApiKey) {
        // Use Ollama (convert messages to Ollama format)
        response = await this.callOllama(modelConfig.model, messages, temperature, maxTokens);
      } else {
        throw new Error('No API key configured for the selected model');
      }

      // Update history
      this.updateHistory(sessionId, prompt, response.content);

      return {
        success: true,
        content: response.content,
        model: model,
        provider: response.provider,
        usage: response.usage || { prompt_tokens: 0, completion_tokens: 0 },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Chat engine error details:', error); // More detailed log
      
      // Fallback response with helpful message
      return {
        success: true,
        content: this.getFallbackResponse(prompt, error.message, error),
        model: options.model || 'gpt-3.5-turbo',
        provider: 'fallback',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Call OpenAI API (non-streaming)
   */
  async callOpenAI(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
      provider: 'openai'
    };
  }

  /**
   * Call DeepSeek API (non-streaming)
   */
  async callDeepSeek(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deepseekApiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
      provider: 'deepseek'
    };
  }

  /**
   * Call Ollama API (non-streaming)
   */
  async callOllama(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ollamaApiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return {
      content: data.message.content,
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      provider: 'ollama'
    };
  }

  /**
   * Stream chat response (for real-time applications)
   */
  async *stream(prompt, options = {}) {
    try {
      const {
        model = 'gpt-3.5-turbo',
        temperature = 0.7,
        maxTokens = 2000,
        systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant.'
      } = options;

      const modelConfig = this.models[model] || this.models['gpt-3.5-turbo'];

      // OpenAI streaming
      if (modelConfig.provider === 'openai' && this.openaiApiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.openaiApiKey}`
          },
          body: JSON.stringify({
            model: modelConfig.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens,
            stream: true
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI stream error (${response.status}): ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                yield parsed;
              } catch (e) {
                console.warn('Parse error in stream chunk:', e.message);
              }
            }
          }
        }
      }
      // DeepSeek streaming (similar to OpenAI)
      else if (modelConfig.provider === 'deepseek' && this.deepseekApiKey) {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.deepseekApiKey}`
          },
          body: JSON.stringify({
            model: modelConfig.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens,
            stream: true
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`DeepSeek stream error (${response.status}): ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                yield parsed;
              } catch (e) {
                console.warn('Parse error in stream chunk:', e.message);
              }
            }
          }
        }
      }
      // Ollama simulation (no true streaming)
      else if (this.ollamaApiKey) {
        const result = await this.chat(prompt, { model, temperature, maxTokens, systemPrompt });
        const words = result.content.split(' ');

        for (let i = 0; i < words.length; i++) {
          yield {
            choices: [{
              delta: { content: words[i] + (i < words.length - 1 ? ' ' : '') },
              index: 0,
              finish_reason: i === words.length - 1 ? 'stop' : null
            }]
          };
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      } else {
        throw new Error('No API key configured for streaming');
      }
    } catch (error) {
      console.error('Stream error:', error);
      // Yield an error chunk so frontend can display it
      yield {
        error: error.message,
        choices: [{
          delta: { content: `\n\n❌ Error: ${error.message}` },
          index: 0,
          finish_reason: 'stop'
        }]
      };
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
  async testOllamaConnection() {
    try {
      const endpoint = 'https://api.ollama.com/api/tags';
      const response = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${this.ollamaApiKey}`,
          'Accept': 'application/json'
        }
      });
      if (response.ok) {
        console.log('✅ Ollama Cloud connection verified');
      } else {
        console.warn('⚠️ Ollama Cloud connection failed');
      }
    } catch (error) {
      // Ignore
    }
  }

  /**
   * Get fallback response when APIs are unavailable
   */
  getFallbackResponse(prompt, errorMsg, errorObj) {
    // Log the full error for debugging (but not to user)
    console.error('Full error object:', errorObj);
    
    const isApiKeyError = errorMsg.includes('API key') || errorMsg.includes('401') || errorMsg.includes('403');
    
    if (isApiKeyError) {
      return `🔑 **API Key Issue Detected**

I notice there's an issue with your OpenAI, DeepSeek, or Ollama API key. Here's how to fix it:

1. Verify your API keys in the Render environment variables
2. Ensure the keys haven't expired

**Your prompt was:** "${prompt.substring(0, 100)}..."

Once the API keys are fixed, I'll be able to provide intelligent responses using powerful AI models!`;
    }

    return `🌐 **Connection Issue**

I'm having trouble connecting to the AI service at the moment. This could be due to network issues or service unavailability.

**Your question:** "${prompt.substring(0, 100)}..."

Please try again in a few moments.`;
  }
}

module.exports = new ChatEngine();
