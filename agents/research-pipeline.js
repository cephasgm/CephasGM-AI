/**
 * Research Pipeline Agent
 * Multi-stage research with web search, summarization, and analysis
 * Integrated with feedback loop for learning.
 */
const fetch = require("node-fetch");
const EventEmitter = require('events');
const feedbackLoop = require('../learning/feedback-loop'); // Added for feedback recording

class ResearchPipeline extends EventEmitter {
  constructor() {
    super();
    
    this.sources = ['wikipedia', 'web', 'news', 'academic'];
    this.cache = new Map();
    this.researchHistory = [];
  }

  /**
   * Run research pipeline on a topic
   */
  async run(topic, options = {}) {
    const {
      depth = 'basic',
      includeSources = true,
      maxResults = 5,
      timeout = 10000
    } = options;

    console.log(`🔬 Research pipeline running on: "${topic}"`);

    const startTime = Date.now();
    const researchId = this.generateResearchId();

    // Check cache first
    const cacheKey = `${topic}:${depth}`;
    if (this.cache.has(cacheKey) && !options.noCache) {
      console.log('📦 Using cached research result');
      return this.cache.get(cacheKey);
    }

    try {
      // Stage 1: Gather information from multiple sources
      const sources = await this.gatherSources(topic, maxResults);
      
      // Stage 2: Extract key information
      const extracted = await this.extractKeyInfo(sources);
      
      // Stage 3: Generate summary
      const summary = await this.generateSummary(topic, extracted, depth);
      
      // Stage 4: Find related topics
      const related = await this.findRelatedTopics(topic);
      
      // Stage 5: Generate insights
      const insights = await this.generateInsights(topic, extracted);

      const result = {
        id: researchId,
        topic,
        summary,
        sources: includeSources ? sources : sources.map(s => ({ title: s.title, url: s.url })),
        related,
        insights,
        metadata: {
          depth,
          executionTime: Date.now() - startTime,
          sourceCount: sources.length,
          timestamp: new Date().toISOString()
        }
      };

      // Record interaction in feedback loop
      const interactionId = await feedbackLoop.record(
        topic,
        summary,
        { agent: 'research-pipeline', sourceCount: sources.length, depth }
      );
      result.interactionId = interactionId;

      // Cache the result
      this.cache.set(cacheKey, result);
      
      // Store in history
      this.researchHistory.push(result);

      this.emit('researchCompleted', result);

      return result;

    } catch (error) {
      console.error('Research pipeline failed:', error);

      // Record failure
      await feedbackLoop.record(
        topic,
        error.message,
        { agent: 'research-pipeline', error: true }
      );
      
      return {
        id: researchId,
        topic,
        error: error.message,
        summary: `Research on "${topic}" encountered an error. Please try again with a more specific query.`,
        metadata: {
          depth,
          executionTime: Date.now() - startTime,
          error: error.message,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Gather information from multiple sources
   */
  async gatherSources(topic, maxResults) {
    const sources = [];

    // Wikipedia
    try {
      const wiki = await this.searchWikipedia(topic);
      if (wiki) sources.push(wiki);
    } catch (error) {
      console.log('Wikipedia search failed:', error.message);
    }

    // Simulated web search
    const webResults = await this.searchWeb(topic, maxResults);
    sources.push(...webResults);

    // Simulated news
    const newsResults = await this.searchNews(topic);
    sources.push(...newsResults);

    return sources.slice(0, maxResults);
  }

  /**
   * Search Wikipedia
   */
  async searchWikipedia(topic) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
    
    const response = await fetch(url);
    
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
      confidence: 0.95
    };
  }

  /**
   * Search web (simulated)
   */
  async searchWeb(topic, count) {
    // Simulate web search
    await this.sleep(500);

    const results = [];
    
    for (let i = 0; i < count; i++) {
      results.push({
        source: 'web',
        title: `${topic} - Article ${i + 1}`,
        snippet: `This is a simulated web result about ${topic}. In production, this would connect to real search APIs.`,
        url: `https://example.com/article/${i}`,
        confidence: 0.7 + (Math.random() * 0.2)
      });
    }

    return results;
  }

  /**
   * Search news (simulated)
   */
  async searchNews(topic) {
    await this.sleep(300);

    return [
      {
        source: 'news',
        title: `Breaking: New developments in ${topic}`,
        snippet: `Recent advances in ${topic} show promising results for AI applications.`,
        url: `https://news.example.com/${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        confidence: 0.8
      },
      {
        source: 'news',
        title: `How ${topic} is transforming the industry`,
        snippet: `Experts weigh in on the impact of ${topic} on technology and society.`,
        url: `https://news.example.com/analysis`,
        date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        confidence: 0.75
      }
    ];
  }

  /**
   * Extract key information from sources
   */
  async extractKeyInfo(sources) {
    const keyPoints = [];
    const facts = [];

    sources.forEach(source => {
      if (source.extract) {
        // Extract first sentence as key point
        const firstSentence = source.extract.split('.')[0];
        keyPoints.push(firstSentence);
      }
      
      if (source.snippet) {
        keyPoints.push(source.snippet);
      }

      // Extract potential facts (simplified)
      const text = source.extract || source.snippet || '';
      const sentences = text.split('.');
      sentences.forEach(sentence => {
        if (sentence.includes(' is ') || sentence.includes(' are ') || sentence.includes(' was ')) {
          facts.push(sentence.trim());
        }
      });
    });

    return {
      keyPoints: keyPoints.slice(0, 5),
      facts: facts.slice(0, 5)
    };
  }

  /**
   * Generate summary
   */
  async generateSummary(topic, extracted, depth) {
    if (depth === 'basic') {
      return `This research provides an overview of ${topic}. Key findings include: ${extracted.keyPoints.slice(0, 3).join(' ')}`;
    }

    return `${topic} is a significant topic in modern technology. Based on gathered information: ${extracted.keyPoints.join(' ')} Related facts: ${extracted.facts.join(' ')}`;
  }

  /**
   * Find related topics
   */
  async findRelatedTopics(topic) {
    // Simulated related topics
    return [
      `${topic} applications`,
      `Future of ${topic}`,
      `${topic} research`,
      `AI and ${topic}`,
      `${topic} in Africa`
    ];
  }

  /**
   * Generate insights
   */
  async generateInsights(topic, extracted) {
    return [
      `${topic} shows significant potential for growth`,
      `Key applications include research and development`,
      `African innovators are exploring ${topic} for local solutions`
    ];
  }

  /**
   * Deep research with multiple passes
   */
  async deepResearch(topic, passes = 3) {
    console.log(`🔬 Deep research on "${topic}" with ${passes} passes`);

    const allResults = [];

    for (let i = 0; i < passes; i++) {
      console.log(`Pass ${i + 1}/${passes}...`);
      
      const result = await this.run(topic, {
        depth: 'deep',
        noCache: true
      });
      
      allResults.push(result);
      
      // Use previous results to refine next pass
      if (i < passes - 1) {
        topic = `${topic} ${result.related[0] || ''}`;
        await this.sleep(1000);
      }
    }

    // Synthesize final result
    return {
      topic,
      passes,
      results: allResults,
      synthesized: this.synthesizeResults(allResults)
    };
  }

  /**
   * Synthesize multiple research passes
   */
  synthesizeResults(results) {
    const allInsights = results.flatMap(r => r.insights || []);
    const uniqueInsights = [...new Set(allInsights)];
    
    return {
      insights: uniqueInsights,
      confidence: results.reduce((acc, r) => acc + (r.metadata?.confidence || 0.7), 0) / results.length,
      sources: results.length
    };
  }

  /**
   * Get research history
   */
  getHistory(limit = 10) {
    return this.researchHistory.slice(-limit).reverse();
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Research cache cleared');
  }

  /**
   * Generate research ID
   */
  generateResearchId() {
    return `research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ResearchPipeline();
