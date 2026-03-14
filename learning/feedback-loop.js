/**
 * Self-Improving Feedback Loop
 * Records interactions, stores vectors, and builds a knowledge graph of user preferences.
 */
const fs = require("fs").promises;
const path = require("path");
const crypto = require('crypto');
const vectorDb = require('../memory/vector-db');      // For vector storage
const knowledgeGraph = require('../memory/knowledge-graph'); // For user‑interaction relationships

class FeedbackLoop {
  constructor() {
    this.logFile = path.join(__dirname, '../learning.log');
    this.metricsFile = path.join(__dirname, '../metrics.json');
    this.interactions = [];
    this.feedback = [];
    this.metrics = {
      totalInteractions: 0,
      positiveFeedback: 0,
      negativeFeedback: 0,
      averageRating: 0,
      topPerformingAgents: {},
      commonTopics: {}
    };
    
    this.init();
  }

  /**
   * Initialize feedback loop
   */
  async init() {
    await this.loadHistory();
    console.log('🔄 Feedback loop initialized (with persistent memory)');
  }

  /**
   * Generate a deterministic "embedding" from text (placeholder – use a real model in production)
   */
  _embedText(text) {
    const hash = crypto.createHash('sha256').update(text).digest();
    // Convert hash to a vector of 384 numbers (common embedding dimension)
    const vector = [];
    for (let i = 0; i < 384; i++) {
      // Use byte values to generate numbers between -1 and 1
      const byte = hash[i % hash.length];
      vector.push((byte / 127.5) - 1); // maps 0-255 to approx -1..1
    }
    return vector;
  }

  /**
   * Record an interaction (prompt + response) with optional userId
   */
  async record(prompt, response, metadata = {}) {
    const id = this.generateId();
    const userId = metadata.userId || 'anonymous';
    const timestamp = new Date().toISOString();

    const interaction = {
      id,
      prompt,
      response,
      userId,
      metadata,
      timestamp,
      feedback: null
    };

    this.interactions.push(interaction);
    this.metrics.totalInteractions++;

    // Log to file (optional)
    await this.log(interaction);

    // Generate embedding and store in vector database
    const text = `${prompt} ${response}`;
    const vector = this._embedText(text);
    await vectorDb.add(vector, {
      interactionId: id,
      userId,
      agent: metadata.agent,
      timestamp,
      promptPreview: prompt.substring(0, 100)
    });

    // Update topic metrics
    this.updateTopicMetrics(prompt);

    return id;
  }

  /**
   * Submit feedback for an interaction, with rating (1-5)
   */
  async submitFeedback(interactionId, feedback, rating = null) {
    const interaction = this.interactions.find(i => i.id === interactionId);
    
    if (!interaction) {
      throw new Error('Interaction not found');
    }

    const finalRating = rating || (feedback.toLowerCase().includes('good') ? 5 : 3);

    const feedbackEntry = {
      interactionId,
      feedback,
      rating: finalRating,
      timestamp: new Date().toISOString()
    };

    interaction.feedback = feedbackEntry;
    this.feedback.push(feedbackEntry);

    // Update metrics
    if (finalRating >= 4) {
      this.metrics.positiveFeedback++;
      if (interaction.metadata.agent) {
        this.metrics.topPerformingAgents[interaction.metadata.agent] =
          (this.metrics.topPerformingAgents[interaction.metadata.agent] || 0) + 1;
      }
    } else if (finalRating <= 2) {
      this.metrics.negativeFeedback++;
    }

    this.updateAverageRating();

    // Store feedback in knowledge graph (user –[liked/disliked]→ interaction)
    const userId = interaction.userId || 'anonymous';
    const relation = finalRating >= 4 ? 'liked' : (finalRating <= 2 ? 'disliked' : 'neutral');
    await knowledgeGraph.link(userId, relation, interactionId, {
      rating: finalRating,
      feedback,
      timestamp: feedbackEntry.timestamp
    });

    // Also update the interaction node with the feedback
    await knowledgeGraph.addNode(interactionId, {
      prompt: interaction.prompt.substring(0, 200),
      agent: interaction.metadata.agent,
      timestamp: interaction.timestamp,
      rating: finalRating
    });

    // Save metrics
    await this.saveMetrics();

    // Learn from feedback (pattern analysis)
    await this.learn(feedbackEntry);

    return {
      success: true,
      feedback: feedbackEntry
    };
  }

  /**
   * Find interactions similar to a given text (query)
   */
  async findSimilarInteractions(query, userId = null, limit = 5, threshold = 0.5) {
    const queryVector = this._embedText(query);
    let results = await vectorDb.search(queryVector, limit * 2, threshold); // get more, then filter

    // If userId provided, filter by user (metadata.userId)
    if (userId) {
      results.results = results.results.filter(r => r.metadata?.userId === userId);
    }
    results.results = results.results.slice(0, limit);
    return results;
  }

  /**
   * Get user's preferences (liked/disliked interactions)
   */
  async getUserPreferences(userId) {
    // Get all edges from user
    const relations = await knowledgeGraph.get(userId);
    const liked = relations.filter(r => r.relation === 'liked');
    const disliked = relations.filter(r => r.relation === 'disliked');
    const neutral = relations.filter(r => r.relation === 'neutral');

    // For each liked/disliked, fetch the interaction node details
    const enrich = async (edges) => {
      const enriched = [];
      for (const edge of edges) {
        const node = await knowledgeGraph.get(edge.entity); // entity is interactionId
        enriched.push({
          interactionId: edge.entity,
          rating: edge.properties?.rating,
          timestamp: edge.properties?.timestamp,
          prompt: node.properties?.prompt,
          agent: node.properties?.agent
        });
      }
      return enriched;
    };

    return {
      userId,
      liked: await enrich(liked),
      disliked: await enrich(disliked),
      neutral: await enrich(neutral)
    };
  }

  /**
   * Log interaction to file
   */
  async log(interaction) {
    try {
      await fs.appendFile(this.logFile, JSON.stringify(interaction) + '\n');
    } catch (error) {
      console.error('Failed to write to log:', error);
    }
  }

  /**
   * Load history from log file (optional)
   */
  async loadHistory() {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const lines = data.split('\n').filter(Boolean);
      
      this.interactions = lines.map(line => JSON.parse(line));
      this.metrics.totalInteractions = this.interactions.length;
      
      console.log(`📊 Loaded ${this.interactions.length} past interactions`);
      
      // Load metrics if available
      try {
        const metricsData = await fs.readFile(this.metricsFile, 'utf8');
        this.metrics = { ...this.metrics, ...JSON.parse(metricsData) };
      } catch {
        // No metrics file yet
      }
      
    } catch (error) {
      console.log('No existing feedback log found, starting fresh');
    }
  }

  /**
   * Save metrics to file
   */
  async saveMetrics() {
    try {
      await fs.writeFile(this.metricsFile, JSON.stringify(this.metrics, null, 2));
    } catch (error) {
      console.error('Failed to save metrics:', error);
    }
  }

  /**
   * Update average rating
   */
  updateAverageRating() {
    if (this.feedback.length === 0) return;
    const sum = this.feedback.reduce((acc, f) => acc + f.rating, 0);
    this.metrics.averageRating = sum / this.feedback.length;
  }

  /**
   * Update topic metrics
   */
  updateTopicMetrics(prompt) {
    const words = prompt.toLowerCase().split(/\s+/);
    const topics = words.filter(w => w.length > 4);
    topics.forEach(topic => {
      this.metrics.commonTopics[topic] = (this.metrics.commonTopics[topic] || 0) + 1;
    });
  }

  /**
   * Learn from feedback (pattern analysis)
   */
  async learn(feedback) {
    console.log('🧠 Learning from feedback:', feedback);
    
    // Analyze patterns
    const patterns = this.analyzePatterns();
    if (patterns.length > 0) {
      console.log('📈 Detected patterns:', patterns);
    }
  }

  /**
   * Analyze patterns in feedback
   */
  analyzePatterns() {
    const patterns = [];
    const negativeFeedbacks = this.feedback.filter(f => f.rating <= 2);
    if (negativeFeedbacks.length > 3) {
      patterns.push('Multiple negative feedbacks detected - consider adjusting system');
    }
    const topics = Object.entries(this.metrics.commonTopics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (topics.length > 0) {
      patterns.push(`Popular topics: ${topics.map(([t, c]) => `${t} (${c})`).join(', ')}`);
    }
    return patterns;
  }

  /**
   * Get learning insights (including user preferences)
   */
  async getInsights(userId = null) {
    const baseInsights = {
      metrics: this.metrics,
      recentFeedback: this.feedback.slice(-10),
      popularTopics: Object.entries(this.metrics.commonTopics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      topAgents: Object.entries(this.metrics.topPerformingAgents)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      recommendations: this.generateRecommendations()
    };

    if (userId) {
      baseInsights.userPreferences = await this.getUserPreferences(userId);
    }

    return baseInsights;
  }

  /**
   * Generate recommendations based on learning
   */
  generateRecommendations() {
    const recommendations = [];
    if (this.metrics.negativeFeedback > this.metrics.positiveFeedback) {
      recommendations.push('Consider reviewing system responses - negative feedback outweighs positive');
    }
    if (this.metrics.averageRating < 3) {
      recommendations.push('Overall satisfaction is low - investigate common issues');
    }
    if (this.interactions.length > 100 && this.feedback.length < 10) {
      recommendations.push('Low feedback rate - encourage more user feedback');
    }
    return recommendations;
  }

  /**
   * Get interaction history
   */
  getHistory(limit = 100) {
    return this.interactions.slice(-limit).reverse();
  }

  /**
   * Get feedback for a specific interaction
   */
  getFeedback(interactionId) {
    return this.feedback.find(f => f.interactionId === interactionId);
  }

  /**
   * Generate improvement suggestions (using insights)
   */
  async generateImprovements() {
    const insights = await this.getInsights();
    const improvements = [];
    if (insights.popularTopics.length > 0) {
      improvements.push(`Optimize for topics: ${insights.popularTopics.slice(0, 3).map(([t]) => t).join(', ')}`);
    }
    if (insights.topAgents.length > 0) {
      improvements.push(`Prioritize agents: ${insights.topAgents.slice(0, 2).map(([a]) => a).join(', ')}`);
    }
    return improvements;
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `interaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear all data (use with caution)
   */
  async clear() {
    this.interactions = [];
    this.feedback = [];
    this.metrics = {
      totalInteractions: 0,
      positiveFeedback: 0,
      negativeFeedback: 0,
      averageRating: 0,
      topPerformingAgents: {},
      commonTopics: {}
    };
    
    try {
      await fs.writeFile(this.logFile, '');
      await fs.writeFile(this.metricsFile, '');
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
    
    return { success: true };
  }
}

module.exports = new FeedbackLoop();
