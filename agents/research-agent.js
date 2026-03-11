/**
 * Research Agent - Autonomous web research
 */
const Agent = require("../core/agent-runtime");
const fetch = require("node-fetch");

class ResearchAgent extends Agent {
  constructor() {
    super("research", {
      timeout: 15000,
      maxRetries: 2
    });
    
    this.cache = new Map();
    this.sources = ['wikipedia', 'duckduckgo', 'news'];
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'research', 'search', 'find', 'lookup', 'what is', 'who is',
      'tell me about', 'information on', 'wiki', 'wikipedia'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['web search', 'wikipedia lookup', 'fact checking', 'data aggregation'];
  }

  /**
   * Execute research task
   */
  async execute(task) {
    this.validateTask(task);
    
    const topic = this.extractTopic(task);
    console.log(`🔍 Research agent searching: "${topic}"`);
    
    // Check cache first
    if (this.cache.has(topic)) {
      console.log('📦 Using cached result');
      return this.cache.get(topic);
    }
    
    try {
      // Try Wikipedia first
      let result = await this.searchWikipedia(topic);
      
      // If Wikipedia fails, try simulated search
      if (!result) {
        result = await this.searchWeb(topic);
      }
      
      // Cache the result
      this.cache.set(topic, result);
      
      return result;
      
    } catch (error) {
      console.error('Research failed:', error);
      return this.getFallbackResult(topic);
    }
  }

  /**
   * Search Wikipedia
   */
  async searchWikipedia(topic) {
    try {
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        { timeout: 5000 }
      );
      
      if (!response.ok) {
        return null;
      }
      
      const data = await response.json();
      
      return {
        source: 'wikipedia',
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page,
        thumbnail: data.thumbnail?.source,
        timestamp: new Date().toISOString()
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
    // Simulate web search
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const results = [
      {
        title: `${topic} - Overview`,
        snippet: `${topic} is an important topic in modern technology and AI. Recent developments have shown promising results in various applications.`,
        url: 'https://example.com/overview'
      },
      {
        title: `Latest research on ${topic}`,
        snippet: `New studies suggest that ${topic} could revolutionize how we approach artificial intelligence and machine learning systems.`,
        url: 'https://example.com/research'
      },
      {
        title: `${topic} in Africa`,
        snippet: `African innovators are applying ${topic} to solve local challenges in healthcare, agriculture, and education.`,
        url: 'https://example.com/africa'
      }
    ];
    
    return {
      source: 'web',
      topic,
      results,
      count: results.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extract topic from task
   */
  extractTopic(task) {
    // Remove common prefixes
    const patterns = [
      /research\s+/i, /search for\s+/i, /find\s+/i, /what is\s+/i,
      /who is\s+/i, /tell me about\s+/i, /information on\s+/i, /wiki\s+/i
    ];
    
    let topic = task;
    patterns.forEach(pattern => {
      topic = topic.replace(pattern, '');
    });
    
    return topic.trim();
  }

  /**
   * Get fallback result when search fails
   */
  getFallbackResult(topic) {
    return {
      source: 'fallback',
      topic,
      summary: `Research on "${topic}" is currently unavailable. Please try a more specific query.`,
      suggestions: [
        'Try using more specific keywords',
        'Check your internet connection',
        'Use the Wikipedia API directly'
      ],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear research cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Research cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      topics: Array.from(this.cache.keys())
    };
  }
}

module.exports = new ResearchAgent();
