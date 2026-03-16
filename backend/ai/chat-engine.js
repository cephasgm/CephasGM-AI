/**
 * AI Chat Engine - Core chat functionality with OpenAI, Ollama, and DeepSeek
 * Enhanced with streaming support, robust error handling, and automatic failover.
 * Ollama model names now include proper tags (e.g., llama3.2:3b).
 */
const fetch = require('node-fetch');
const config = require('../config');

class ChatEngine {
  constructor() {
    this.models = {
      // OpenAI models (kept for future paid use)
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
      // Ollama models (with correct tags) – currently free
      'llama3': { 
        provider: 'ollama', 
        model: 'llama3:8b',
        description: 'Meta Llama 3 8B - Good general purpose'
      },
      'llama3.2': { 
        provider: 'ollama', 
        model: 'llama3.2:3b',
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
      // DeepSeek model (kept for future)
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
    console.log(`   OpenAI: ${this.openaiApiKey ? '✅ Configured' : '❌ Missing (will be used later)'}`);
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   DeepSeek: ${this.deepseekApiKey ? '✅ Configured' : '❌ Missing (will be used later)'}`);
    console.log(`   Available models: ${Object.keys(this.models).length}`);
    
    if (this.ollamaApiKey) {
      this.testOllamaConnection().catch(() => {});
    }
  }

  /**
   * Send chat message and get response (non-streaming) with automatic failover.
   */
  async chat(prompt, options = {}) {
    try {
      const {
        model = 'llama3.2',          // Default to a free Ollama model
        temperature = 0.7,
        maxTokens = 2000,
        sessionId = 'default',
        systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant helping users with technology, innovation, and African perspectives.'
      } = options;

      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      console.log(`💬 Chat request [${model}]: "${prompt.substring(0, 50)}..."`);

      const history = this.getHistory(sessionId);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: prompt }
      ];

      const requestedConfig = this.models[model] || this.models['llama3.2'];
      const requestedProvider = requestedConfig.provider;

      // Build list of providers to try:
      // 1. The requested provider (if its key is present)
      // 2. Then Ollama (free), then OpenAI, then DeepSeek (as fallbacks)
      const providersToTry = [];

      const addProvider = (name, condition, caller, modelName) => {
        if (condition) providersToTry.push({ name, caller, model: modelName });
      };

      // Requested provider first
      if (requestedProvider === 'openai' && this.openaiApiKey) {
        addProvider('openai', true, this.callOpenAI.bind(this), requestedConfig.model);
      } else if (requestedProvider === 'deepseek' && this.deepseekApiKey) {
        addProvider('deepseek', true, this.callDeepSeek.bind(this), requestedConfig.model);
      } else if (requestedProvider === 'ollama' && this.ollamaApiKey) {
        addProvider('ollama', true, this.callOllama.bind(this), requestedConfig.model);
      }

      // Then add all available providers as fallbacks (prioritise free Ollama)
      if (this.ollamaApiKey && requestedProvider !== 'ollama') {
        addProvider('ollama', true, this.callOllama.bind(this), 'llama3.2:3b');
      }
      if (this.openaiApiKey && requestedProvider !== 'openai') {
        addProvider('openai', true, this.callOpenAI.bind(this), 'gpt-3.5-turbo');
      }
      if (this.deepseekApiKey && requestedProvider !== 'deepseek') {
        addProvider('deepseek', true, this.callDeepSeek.bind(this), 'deepseek-chat');
      }

      if (providersToTry.length === 0) {
        throw new Error('No API keys configured for any provider');
      }

      const errors = [];
      let lastError = null;

      for (const provider of providersToTry) {
        try {
          console.log(`🔄 Trying provider: ${provider.name} with model ${provider.model}`);
          const response = await provider.caller(provider.model, messages, temperature, maxTokens);
          
          this.updateHistory(sessionId, prompt, response.content);
          return {
            success: true,
            content: response.content,
            model: model,
            provider: response.provider,
            usage: response.usage || { prompt_tokens: 0, completion_tokens: 0 },
            timestamp: new Date().toISOString()
          };
        } catch (err) {
          console.warn(`❌ Provider ${provider.name} failed:`, err.message);
          errors.push(`${provider.name}: ${err.message}`);
          lastError = err;
        }
      }

      const errorSummary = errors.join('; ');
      console.error('All providers failed:', errorSummary);

      return {
        success: true,
        content: this.getFallbackResponse(prompt, errorSummary, lastError),
        model: options.model || 'llama3.2',
        provider: 'fallback',
        error: errorSummary,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Chat engine error details:', error);
      return {
        success: true,
        content: this.getFallbackResponse(prompt, error.message, error),
        model: options.model || 'llama3.2',
        provider: 'fallback',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // ---------- Provider call methods (unchanged) ----------
  async callOpenAI(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return { content: data.choices[0].message.content, usage: data.usage, provider: 'openai' };
  }

  async callDeepSeek(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deepseekApiKey}`
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return { content: data.choices[0].message.content, usage: data.usage, provider: 'deepseek' };
  }

  async callOllama(model, messages, temperature, maxTokens) {
    const response = await fetch('https://api.ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ollamaApiKey}`
      },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature, num_predict: maxTokens } })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }
    const data = await response.json();
    return { content: data.message.content, usage: { prompt_tokens: 0, completion_tokens: 0 }, provider: 'ollama' };
  }

  // ---------- Streaming method (unchanged) ----------
  async *stream(prompt, options = {}) {
    try {
      const { model = 'llama3.2', temperature = 0.7, maxTokens = 2000, systemPrompt = 'You are CephasGM AI...' } = options;
      const modelConfig = this.models[model] || this.models['llama3.2'];

      if (modelConfig.provider === 'openai' && this.openaiApiKey) {
        // OpenAI streaming (unchanged)
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
          body: JSON.stringify({
            model: modelConfig.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
            temperature, max_tokens: maxTokens, stream: true
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
              try { yield JSON.parse(data); } catch (e) { console.warn('Parse error', e.message); }
            }
          }
        }
      } else if (modelConfig.provider === 'deepseek' && this.deepseekApiKey) {
        // DeepSeek streaming (unchanged)
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.deepseekApiKey}` },
          body: JSON.stringify({
            model: modelConfig.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
            temperature, max_tokens: maxTokens, stream: true
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
              try { yield JSON.parse(data); } catch (e) { console.warn('Parse error', e.message); }
            }
          }
        }
      } else if (this.ollamaApiKey) {
        // Ollama simulation (no true streaming)
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

  // ---------- History methods (unchanged) ----------
  getHistory(sessionId) {
    if (!this.conversationHistory.has(sessionId)) this.conversationHistory.set(sessionId, []);
    return this.conversationHistory.get(sessionId).slice(-6);
  }

  updateHistory(sessionId, userMessage, aiResponse) {
    const history = this.conversationHistory.get(sessionId) || [];
    history.push({ role: 'user', content: userMessage }, { role: 'assistant', content: aiResponse });
    if (history.length > 20) history.splice(0, history.length - 20);
    this.conversationHistory.set(sessionId, history);
  }

  clearHistory(sessionId) {
    this.conversationHistory.delete(sessionId);
    return { success: true, message: 'History cleared' };
  }

  getModels() {
    return Object.entries(this.models).map(([name, config]) => ({
      id: name, name, fullName: config.model, provider: config.provider, description: config.description
    }));
  }

  async testOllamaConnection() {
    try {
      const response = await fetch('https://api.ollama.com/api/tags', {
        headers: { 'Authorization': `Bearer ${this.ollamaApiKey}`, 'Accept': 'application/json' }
      });
      if (response.ok) console.log('✅ Ollama Cloud connection verified');
      else console.warn('⚠️ Ollama Cloud connection failed');
    } catch (error) { /* ignore */ }
  }

  getFallbackResponse(prompt, errorMsg, errorObj) {
    console.error('Full error object:', errorObj);
    const isApiKeyError = errorMsg.includes('API key') || errorMsg.includes('401') || errorMsg.includes('403');
    if (isApiKeyError) {
      return `🔑 **API Key Issue Detected**

I notice there's an issue with your API keys. Here's how to fix it:

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
