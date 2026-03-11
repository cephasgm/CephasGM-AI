/**
 * Research Agent - Autonomous web research and information gathering
 */
const fetch = require('node-fetch');

class ResearchAgent {
  constructor() {
    this.name = 'research';
    this.sources = ['wikipedia', 'duckduckgo', 'news', 'academic'];
  }

  /**
   * Check if this agent can handle the task
   */
  canHandle(task) {
    const keywords = [
      'research', 'search', 'find', 'lookup', 'what is', 'who is', 
      'tell me about', 'information on', 'details about', 'explain'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['web search', 'wikipedia lookup', 'news aggregation', 'fact checking'];
  }

  /**
   * Execute research task
   */
  async execute(task, params = {}) {
    try {
      const topic = this.extractTopic(task);
      console.log(`Researching topic: "${topic}"`);
      
      // Determine research depth
      const depth = params.depth || 'basic';
      
      // Gather information from multiple sources
      const results = await Promise.allSettled([
        this.searchWikipedia(topic),
        this.searchWeb(topic),
        this.searchNews(topic)
      ]);

      // Compile results
      const research = {
        topic: topic,
        summary: await this.generateSummary(topic, results),
        sources: [],
        timestamp: new Date().toISOString(),
        depth: depth
      };

      // Add successful sources
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          research.sources.push({
            type: ['wikipedia', 'web', 'news'][index],
            data: result.value
          });
        }
      });

      // Add related topics
      research.related = await this.findRelatedTopics(topic);

      return research;

    } catch (error) {
      console.error('Research agent error:', error);
      return {
        error: error.message,
        topic: task,
        fallback: 'Unable to complete research at this time'
      };
    }
  }

  /**
   * Extract main topic from task
   */
  extractTopic(task) {
    // Remove common prefixes
    const patterns = [
      /research\s+/i,
      /search for\s+/i,
      /find\s+/i,
      /what is\s+/i,
      /who is\s+/i,
      /tell me about\s+/i,
      /information on\s+/i
    ];

    let topic = task;
    patterns.forEach(pattern => {
      topic = topic.replace(pattern, '');
    });

    return topic.trim();
  }

  /**
   * Search Wikipedia
   */
  async searchWikipedia(topic) {
    try {
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
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
    // Simulated web search - in production, use actual search API
    await this.simulateDelay(500);
    
    return {
      title: `Web results for: ${topic}`,
      snippets: [
        `${topic} is an important topic in modern technology.`,
        `Recent developments in ${topic} have shown promising results.`,
        `Experts suggest that ${topic} will continue to evolve.`
      ],
      results: 42
    };
  }

  /**
   * Search news (simulated)
   */
  async searchNews(topic) {
    // Simulated news search
    await this.simulateDelay(300);
    
    return {
      title: `Latest news about ${topic}`,
      articles: [
        {
          headline: `Breaking: New developments in ${topic}`,
          date: new Date().toLocaleDateString(),
          source: 'Tech News'
        },
        {
          headline: `How ${topic} is changing the industry`,
          date: new Date(Date.now() - 86400000).toLocaleDateString(),
          source: 'AI Weekly'
        }
      ]
    };
  }

  /**
   * Generate summary from gathered information
   */
  async generateSummary(topic, results) {
    let summary = `Based on research about "${topic}":\n\n`;
    
    // Add Wikipedia summary if available
    const wikiResult = results[0];
    if (wikiResult.status === 'fulfilled' && wikiResult.value) {
      summary += wikiResult.value.extract + '\n\n';
    } else {
      summary += `${topic} is a topic of interest in the AI and technology space. `;
      summary += `Further research would provide more specific information.\n\n`;
    }

    return summary;
  }

  /**
   * Find related topics
   */
  async findRelatedTopics(topic) {
    // Simulated related topics
    const topics = [
      `Artificial Intelligence and ${topic}`,
      `Future of ${topic}`,
      `${topic} applications`,
      `${topic} research papers`
    ];
    
    return topics;
  }

  /**
   * Simulate delay (for demo)
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ResearchAgent();
