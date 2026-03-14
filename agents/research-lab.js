/**
 * Research Lab Agent - Advanced research capabilities
 * Multi-source research with analysis and synthesis
 * Integrated with feedback loop for learning.
 */
const EventEmitter = require('events');
const fetch = require('node-fetch');
const feedbackLoop = require('../learning/feedback-loop'); // Added for feedback recording

class ResearchLab extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.id = config.id || `research_${Date.now()}`;
    this.type = 'research';
    this.config = {
      maxSources: config.maxSources || 5,
      timeout: config.timeout || 15000,
      cacheResults: config.cacheResults !== false,
      ...config
    };
    
    this.cache = new Map();
    this.researchHistory = [];
    this.sources = ['wikipedia', 'web', 'news', 'academic'];
    
    console.log(`🔬 ResearchLab [${this.id}] initialized`);
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'research', 'search', 'find', 'lookup', 'what is', 'who is',
      'tell me about', 'information on', 'study', 'analyze', 'investigate'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['research', 'web search', 'fact checking', 'data synthesis'];
  }

  /**
   * Execute research task
   */
  async execute(task, options = {}) {
    const startTime = Date.now();
    const researchId = this.generateResearchId();

    console.log(`🔬 Research lab investigating: "${task.substring(0, 50)}..."`);

    try {
      // Extract topic
      const topic = this.extractTopic(task);

      // Check cache
      const cacheKey = `${topic}:${options.depth || 'basic'}`;
      if (this.config.cacheResults && this.cache.has(cacheKey)) {
        console.log('📦 Using cached research result');
        return this.cache.get(cacheKey);
      }

      // Gather information from multiple sources
      const sources = await this.gatherSources(topic, options);

      // Extract key information
      const extracted = await this.extractKeyInfo(sources);

      // Generate summary
      const summary = await this.generateSummary(topic, extracted, options);

      // Find related topics
      const related = await this.findRelatedTopics(topic);

      // Generate insights
      const insights = await this.generateInsights(topic, extracted, sources);

      // Synthesize final result
      const result = {
        id: researchId,
        topic,
        summary,
        sources: sources.map(s => ({
          title: s.title,
          url: s.url,
          confidence: s.confidence,
          source: s.source
        })),
        findings: extracted.findings || [],
        keyPoints: extracted.keyPoints || [],
        related,
        insights,
        metadata: {
          executionTime: Date.now() - startTime,
          sourceCount: sources.length,
          timestamp: new Date().toISOString()
        }
      };

      // Record interaction in feedback loop
      const interactionId = await feedbackLoop.record(
        topic,
        summary,
        { agent: 'research-lab', id: this.id, sourceCount: sources.length }
      );
      result.interactionId = interactionId;

      // Cache result
      if (this.config.cacheResults) {
        this.cache.set(cacheKey, result);
      }

      // Store in history
      this.researchHistory.push(result);

      this.emit('researchCompleted', { researchId, topic, interactionId });

      return result;

    } catch (error) {
      console.error('Research lab failed:', error);

      // Record failure
      await feedbackLoop.record(
        task,
        error.message,
        { agent: 'research-lab', id: this.id, error: true }
      );

      return {
        id: researchId,
        error: error.message,
        summary: `Research on "${task}" encountered an error. Please try again with a more specific query.`,
        metadata: {
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
  async gatherSources(topic, options) {
    const sources = [];
    const maxSources = options.maxSources || this.config.maxSources;

    // Wikipedia
    try {
      const wiki = await this.searchWikipedia(topic);
      if (wiki) {
        sources.push(wiki);
      }
    } catch (error) {
      console.log('Wikipedia search failed:', error.message);
    }

    // Simulated web search
    const webResults = await this.searchWeb(topic, maxSources);
    sources.push(...webResults);

    // Simulated academic search
    const academicResults = await this.searchAcademic(topic);
    sources.push(...academicResults);

    return sources.slice(0, maxSources);
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
      confidence: 0.95,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Search web (simulated)
   */
  async searchWeb(topic, count) {
    await this.simulateDelay(300);

    const results = [];
    
    for (let i = 0; i < count; i++) {
      results.push({
        source: 'web',
        title: `${topic} - Article ${i + 1}`,
        snippet: `This is a simulated web result about ${topic}. In production, this would connect to real search APIs.`,
        url: `https://example.com/article/${i}`,
        confidence: 0.7 + (Math.random() * 0.2),
        timestamp: new Date().toISOString()
      });
    }

    return results;
  }

  /**
   * Search academic sources (simulated)
   */
  async searchAcademic(topic) {
    await this.simulateDelay(500);

    return [
      {
        source: 'academic',
        title: `Recent advances in ${topic}: A comprehensive review`,
        authors: ['Smith, J.', 'Johnson, M.', 'Williams, K.'],
        journal: 'Journal of AI Research',
        year: 2024,
        abstract: `This paper examines the latest developments in ${topic} and their implications for artificial intelligence.`,
        confidence: 0.85,
        timestamp: new Date().toISOString()
      },
      {
        source: 'academic',
        title: `${topic} in African technology ecosystems`,
        authors: ['Okafor, C.', 'Mutua, P.', 'van der Merwe, J.'],
        journal: 'African Journal of Technology',
        year: 2023,
        abstract: `Exploring the impact and applications of ${topic} across African innovation hubs.`,
        confidence: 0.9,
        timestamp: new Date().toISOString()
      }
    ];
  }

  /**
   * Extract key information from sources
   */
  async extractKeyInfo(sources) {
    const keyPoints = [];
    const findings = [];

    for (const source of sources) {
      if (source.extract) {
        // Extract first sentence as key point
        const firstSentence = source.extract.split('.')[0];
        keyPoints.push(firstSentence);
      }
      
      if (source.snippet) {
        keyPoints.push(source.snippet);
      }

      if (source.abstract) {
        findings.push({
          source: source.title,
          finding: source.abstract,
          confidence: source.confidence
        });
      }
    }

    return {
      keyPoints: keyPoints.slice(0, 5),
      findings: findings.slice(0, 5)
    };
  }

  /**
   * Generate summary
   */
  async generateSummary(topic, extracted, options) {
    const depth = options.depth || 'basic';

    if (depth === 'basic') {
      return `This research provides an overview of ${topic}. ` +
             `Key findings include: ${extracted.keyPoints.slice(0, 3).join(' ')}`;
    }

    return `${topic} is a significant topic in modern technology. ` +
           `Based on gathered information: ${extracted.keyPoints.join(' ')}. ` +
           `Research indicates ${extracted.findings.length} key findings.`;
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
  async generateInsights(topic, extracted, sources) {
    const insights = [];

    // Source-based insights
    if (sources.length > 3) {
      insights.push(`Multiple sources (${sources.length}) confirm the importance of ${topic}`);
    }

    // Content-based insights
    if (extracted.keyPoints.length > 0) {
      insights.push(`Key themes: ${extracted.keyPoints.slice(0, 2).join(', ')}`);
    }

    return insights;
  }

  /**
   * Extract topic from task
   */
  extractTopic(task) {
    const patterns = [
      /research\s+/i, /search for\s+/i, /find\s+/i, /what is\s+/i,
      /who is\s+/i, /tell me about\s+/i, /information on\s+/i, /study\s+/i
    ];

    let topic = task;
    patterns.forEach(pattern => {
      topic = topic.replace(pattern, '');
    });

    return topic.trim();
  }

  /**
   * Deep research with multiple passes
   */
  async deepResearch(topic, passes = 3) {
    console.log(`🔬 Deep research on "${topic}" with ${passes} passes`);

    const allResults = [];

    for (let i = 0; i < passes; i++) {
      console.log(`Pass ${i + 1}/${passes}...`);
      
      const result = await this.execute(topic, {
        depth: 'deep',
        maxSources: this.config.maxSources + i
      });
      
      allResults.push(result);
      
      if (i < passes - 1) {
        topic = `${topic} ${result.related?.[0] || ''}`;
        await this.simulateDelay(1000);
      }
    }

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
    const allFindings = results.flatMap(r => r.findings || []);
    const uniqueFindings = [...new Set(allFindings.map(f => JSON.stringify(f)))].map(f => JSON.parse(f));
    
    return {
      findings: uniqueFindings,
      confidence: results.reduce((acc, r) => acc + (r.metadata?.confidence || 0.7), 0) / results.length,
      sources: results.reduce((acc, r) => acc + (r.metadata?.sourceCount || 0), 0)
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
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ResearchLab;
