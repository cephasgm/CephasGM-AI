/**
 * Self-Improving Feedback Loop
 * Records interactions and learns from feedback
 */
const fs = require("fs").promises;
const path = require("path");

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
    console.log('🔄 Feedback loop initialized');
  }

  /**
   * Record an interaction
   */
  async record(prompt, response, metadata = {}) {
    const interaction = {
      id: this.generateId(),
      prompt,
      response,
      metadata,
      timestamp: new Date().toISOString(),
      feedback: null
    };

    this.interactions.push(interaction);
    this.metrics.totalInteractions++;

    // Log to file
    await this.log(interaction);

    // Update topic metrics
    this.updateTopicMetrics(prompt);

    return interaction.id;
  }

  /**
   * Submit feedback for an interaction
   */
  async submitFeedback(interactionId, feedback, rating = null) {
    const interaction = this.interactions.find(i => i.id === interactionId);
    
    if (!interaction) {
      throw new Error('Interaction not found');
    }

    const feedbackEntry = {
      interactionId,
      feedback,
      rating: rating || (feedback.toLowerCase().includes('good') ? 5 : 3),
      timestamp: new Date().toISOString()
    };

    interaction.feedback = feedbackEntry;
    this.feedback.push(feedbackEntry);

    // Update metrics
    if (rating >= 4) {
      this.metrics.positiveFeedback++;
      
      // Track agent performance
      if (interaction.metadata.agent) {
        this.metrics.topPerformingAgents[interaction.metadata.agent] = 
          (this.metrics.topPerformingAgents[interaction.metadata.agent] || 0) + 1;
      }
    } else if (rating <= 2) {
      this.metrics.negativeFeedback++;
    }

    // Update average rating
    this.updateAverageRating();

    // Save metrics
    await this.saveMetrics();

    // Learn from feedback
    await this.learn(feedbackEntry);

    return {
      success: true,
      feedback: feedbackEntry
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
   * Load history from log file
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
   * Learn from feedback
   */
  async learn(feedback) {
    console.log('🧠 Learning from feedback:', feedback);
    
    // In a real system, this would:
    // 1. Update model weights
    // 2. Adjust agent parameters
    // 3. Fine-tune based on preferences
    
    // For now, we'll just analyze patterns
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
    
    // Look for common issues in negative feedback
    const negativeFeedbacks = this.feedback.filter(f => f.rating <= 2);
    
    if (negativeFeedbacks.length > 3) {
      patterns.push('Multiple negative feedbacks detected - consider adjusting system');
    }
    
    // Check for topic preferences
    const topics = Object.entries(this.metrics.commonTopics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (topics.length > 0) {
      patterns.push(`Popular topics: ${topics.map(([t, c]) => `${t} (${c})`).join(', ')}`);
    }
    
    return patterns;
  }

  /**
   * Get learning insights
   */
  getInsights() {
    return {
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
   * Generate improvement suggestions
   */
  async generateImprovements() {
    const insights = this.getInsights();
    const improvements = [];
    
    // Suggest based on popular topics
    if (insights.popularTopics.length > 0) {
      improvements.push(`Optimize for topics: ${insights.popularTopics.slice(0, 3).map(([t]) => t).join(', ')}`);
    }
    
    // Suggest based on agent performance
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
   * Clear all data
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
