/**
 * Research Agent - Autonomous research with AI-powered synthesis
 * Uses chat engine (OpenAI/DeepSeek/Ollama) to generate comprehensive answers.
 */
const fetch = require('node-fetch');
// Import chat engine – adjust path as needed
const chatEngine = require('../backend/ai/chat-engine');

class ResearchAgent {
  constructor() {
    this.name = 'research';
    this.timeout = 30000;
    this.maxRetries = 2;
    
    this.cache = new Map();
    this.sources = ['wikipedia', 'duckduckgo', 'news', 'academic'];
    
    console.log('🔍 Research agent initialized (AI‑powered)');
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'research', 'search', 'find', 'lookup', 'what is', 'who is',
      'tell me about', 'information on', 'wiki', 'wikipedia', 'analyze',
      'investigate', 'study', 'learn about', 'explain', 'summarize'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return [
      'AI‑powered research',
      'web search simulation',
      'fact checking',
      'data synthesis',
      'trend analysis',
      'sentiment analysis'
    ];
  }

  /**
   * Execute research task with AI
   */
  async execute(task) {
    this.validateTask(task);
    
    const topic = this.extractTopic(task);
    console.log(`🔍 Research agent searching: "${topic}"`);
    
    // Check cache first (valid for 1 hour)
    const cacheKey = topic.toLowerCase().trim();
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      const age = Date.now() - cached.timestamp;
      if (age < 3600000) { // 1 hour
        console.log('📦 Using cached result');
        return cached.data;
      }
    }
    
    try {
      // Gather simulated source data (optional – can be used as context)
      const [wikipedia, webResults, newsResults] = await Promise.allSettled([
        this.searchWikipedia(topic),
        this.searchWeb(topic),
        this.searchNews(topic)
      ]);
      
      // Build context from sources (if available)
      let context = '';
      if (wikipedia.status === 'fulfilled' && wikipedia.value) {
        context += `Wikipedia: ${wikipedia.value.extract}\n\n`;
      }
      if (webResults.status === 'fulfilled' && webResults.value) {
        context += `Web: ${webResults.value.results.map(r => r.snippet).join(' ')}\n\n`;
      }
      if (newsResults.status === 'fulfilled' && newsResults.value) {
        context += `News: ${newsResults.value.articles.map(a => a.summary).join(' ')}`;
      }
      
      // If we have context, include it; otherwise just ask the AI directly
      let prompt;
      if (context.trim()) {
        prompt = `Using the following information as context, provide a detailed, well‑structured answer to the research query: "${topic}".\n\nContext:\n${context}\n\nIf the context is insufficient, supplement with your own knowledge. Include key findings, examples, and references where possible.`;
      } else {
        prompt = `Provide a detailed, well‑structured answer to the research query: "${topic}". Include key findings, examples, and references where possible.`;
      }
      
      // Call chat engine with a suitable model (prefer GPT‑4 if available, else fallback)
      const model = 'gpt-4'; // You can change to 'deepseek-chat' or 'llama3.2'
      const result = await chatEngine.chat(prompt, { model, temperature: 0.5, maxTokens: 2000 });
      
      const answer = result.content;
      
      // Structure the final result
      const researchResult = {
        source: 'AI research',
        topic,
        summary: answer,
        sources: this.formatSources({ wikipedia: wikipedia.value, web: webResults.value, news: newsResults.value }),
        confidence: 0.9,
        timestamp: new Date().toISOString()
      };
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: researchResult,
        timestamp: Date.now()
      });
      
      return researchResult;
      
    } catch (error) {
      console.error('Research failed:', error);
      return this.getFallbackResult(topic, error.message);
    }
  }

  /**
   * Search Wikipedia (simulated – real API call)
   */
  async searchWikipedia(topic) {
    try {
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        { timeout: 5000 }
      );
      if (!response.ok) return null;
      const data = await response.json();
      return {
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page,
        thumbnail: data.thumbnail?.source
      };
    } catch (error) {
      console.log('Wikipedia search failed:', error.message);
      return null;
    }
  }

  /**
   * Search web (simulated)
   */
  async searchWeb(topic) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      results: [
        { title: `${topic} overview`, snippet: `This is a simulated web result about ${topic}.`, url: 'https://example.com' }
      ]
    };
  }

  /**
   * Search news (simulated)
   */
  async searchNews(topic) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {
      articles: [
        { title: `${topic} in the news`, summary: `Latest developments in ${topic}.`, date: new Date().toISOString().split('T')[0] }
      ]
    };
  }

  /**
   * Format sources for output
   */
  formatSources(sources) {
    const list = [];
    if (sources.wikipedia?.url) {
      list.push({ type: 'wikipedia', title: sources.wikipedia.title, url: sources.wikipedia.url });
    }
    if (sources.web?.results) {
      sources.web.results.slice(0, 3).forEach(r => list.push({ type: 'web', title: r.title, url: r.url }));
    }
    if (sources.news?.articles) {
      sources.news.articles.slice(0, 2).forEach(a => list.push({ type: 'news', title: a.title }));
    }
    return list;
  }

  /**
   * Extract topic from task
   */
  extractTopic(task) {
    const patterns = [
      /research\s+/i, /search for\s+/i, /find\s+/i, /what is\s+/i,
      /who is\s+/i, /tell me about\s+/i, /information on\s+/i, /wiki\s+/i,
      /analyze\s+/i, /investigate\s+/i, /study\s+/i, /learn about\s+/i,
      /explain\s+/i, /summarize\s+/i
    ];
    let topic = task;
    patterns.forEach(pattern => {
      topic = topic.replace(pattern, '');
    });
    return topic.trim() || task;
  }

  /**
   * Validate task input
   */
  validateTask(task) {
    if (!task || typeof task !== 'string') {
      throw new Error('Task must be a non-empty string');
    }
  }

  /**
   * Clear research cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Research cache cleared');
    return { success: true, message: 'Cache cleared' };
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      topics: Array.from(this.cache.keys()).slice(0, 10),
      oldest: this.cache.size > 0 ? Math.min(...Array.from(this.cache.values()).map(v => v.timestamp)) : null
    };
  }

  /**
   * Get fallback result when research fails
   */
  getFallbackResult(topic, errorMsg) {
    const isApiKeyError = errorMsg.includes('API key') || errorMsg.includes('401');
    if (isApiKeyError) {
      return {
        source: 'fallback',
        topic,
        summary: `🔑 **API Key Required**\n\nPlease configure your OpenAI, DeepSeek, or Ollama API key to enable AI‑powered research.`,
        sources: [],
        confidence: 0.3,
        timestamp: new Date().toISOString()
      };
    }
    return {
      source: 'fallback',
      topic,
      summary: `Research on "${topic}" is currently unavailable. Please try again later.`,
      sources: [],
      confidence: 0.2,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new ResearchAgent();
