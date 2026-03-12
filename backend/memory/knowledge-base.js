/**
 * Knowledge Base
 * Structured storage for facts, relationships, and knowledge
 */
const EventEmitter = require('events');
const crypto = require('crypto');

class KnowledgeBase extends EventEmitter {
  constructor() {
    super();
    
    this.kb = new Map(); // Main storage
    this.categories = new Map(); // Category index
    this.tags = new Map(); // Tag index
    this.relations = new Map(); // Relationship graph
    
    this.metrics = {
      totalEntries: 0,
      totalCategories: 0,
      totalTags: 0,
      totalRelations: 0
    };
  }

  /**
   * Add a knowledge entry
   */
  add(key, value, options = {}) {
    const {
      category = 'general',
      tags = [],
      confidence = 1.0,
      source = 'user',
      ttl = null // Time to live in ms
    } = options;

    const id = this.generateId();
    
    const entry = {
      id,
      key,
      value,
      category,
      tags,
      confidence,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
      ttl: ttl ? Date.now() + ttl : null
    };

    // Store by key (keeps latest)
    this.kb.set(key, entry);

    // Index by category
    if (!this.categories.has(category)) {
      this.categories.set(category, new Map());
    }
    this.categories.get(category).set(key, entry);

    // Index by tags
    tags.forEach(tag => {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Map());
      }
      this.tags.get(tag).set(key, entry);
    });

    this.metrics.totalEntries++;
    this.metrics.totalCategories = this.categories.size;

    this.emit('entryAdded', { key, category, tags });

    return {
      id,
      key,
      success: true
    };
  }

  /**
   * Get a knowledge entry
   */
  get(key, options = {}) {
    const { includeMetadata = false, updateAccess = true } = options;

    const entry = this.kb.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (entry.ttl && Date.now() > entry.ttl) {
      this.kb.delete(key);
      return null;
    }

    if (updateAccess) {
      entry.accessCount++;
      entry.lastAccessed = new Date().toISOString();
    }

    if (includeMetadata) {
      return entry;
    }

    return entry.value;
  }

  /**
   * Get multiple entries by keys
   */
  getMany(keys, options = {}) {
    const results = {};
    
    for (const key of keys) {
      const value = this.get(key, options);
      if (value !== null) {
        results[key] = value;
      }
    }

    return results;
  }

  /**
   * Search knowledge base
   */
  search(query, options = {}) {
    const {
      category = null,
      tags = [],
      limit = 10,
      fuzzy = false
    } = options;

    const results = [];
    const queryLower = query.toLowerCase();

    // Determine search pool
    let pool = this.kb;
    if (category) {
      pool = this.categories.get(category) || new Map();
    }

    // Search entries
    for (const [key, entry] of pool) {
      let match = false;

      // Exact match
      if (key.toLowerCase().includes(queryLower)) {
        match = true;
      }

      // Value match (for string values)
      if (!match && typeof entry.value === 'string') {
        if (entry.value.toLowerCase().includes(queryLower)) {
          match = true;
        }
      }

      // Tag match
      if (!match && tags.length > 0) {
        if (tags.some(tag => entry.tags.includes(tag))) {
          match = true;
        }
      }

      // Fuzzy match (simplified)
      if (!match && fuzzy) {
        // Simple Levenshtein approximation
        const distance = this.levenshteinDistance(queryLower, key.toLowerCase());
        if (distance <= 3) {
          match = true;
        }
      }

      if (match) {
        results.push({
          key,
          value: entry.value,
          category: entry.category,
          tags: entry.tags,
          confidence: entry.confidence,
          score: this.calculateRelevance(query, entry)
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.score - a.score);

    return {
      query,
      count: results.length,
      results: results.slice(0, limit)
    };
  }

  /**
   * Add a relationship between entries
   */
  addRelation(fromKey, relationType, toKey, properties = {}) {
    // Ensure both entries exist
    if (!this.kb.has(fromKey) || !this.kb.has(toKey)) {
      throw new Error('Both entries must exist');
    }

    const relationId = this.generateId();
    
    const relation = {
      id: relationId,
      from: fromKey,
      type: relationType,
      to: toKey,
      properties,
      createdAt: new Date().toISOString()
    };

    if (!this.relations.has(fromKey)) {
      this.relations.set(fromKey, []);
    }

    this.relations.get(fromKey).push(relation);
    this.metrics.totalRelations++;

    this.emit('relationAdded', relation);

    return relationId;
  }

  /**
   * Get all relations for an entry
   */
  getRelations(key, options = {}) {
    const { direction = 'outgoing', type = null } = options;

    const relations = this.relations.get(key) || [];

    let filtered = relations;

    if (type) {
      filtered = filtered.filter(r => r.type === type);
    }

    if (direction === 'incoming') {
      // Find all relations pointing to this key
      const incoming = [];
      for (const [fromKey, rels] of this.relations) {
        if (fromKey !== key) {
          incoming.push(...rels.filter(r => r.to === key));
        }
      }
      return incoming;
    }

    return filtered;
  }

  /**
   * Get entries by category
   */
  getByCategory(category, options = {}) {
    const { limit = 100, offset = 0 } = options;

    const categoryEntries = this.categories.get(category) || new Map();
    const entries = Array.from(categoryEntries.values());

    return {
      category,
      count: entries.length,
      entries: entries.slice(offset, offset + limit)
    };
  }

  /**
   * Get entries by tag
   */
  getByTag(tag, options = {}) {
    const { limit = 100, offset = 0 } = options;

    const tagEntries = this.tags.get(tag) || new Map();
    const entries = Array.from(tagEntries.values());

    return {
      tag,
      count: entries.length,
      entries: entries.slice(offset, offset + limit)
    };
  }

  /**
   * Update an entry
   */
  update(key, value, options = {}) {
    const entry = this.kb.get(key);

    if (!entry) {
      return this.add(key, value, options);
    }

    const updatedEntry = {
      ...entry,
      value,
      updatedAt: new Date().toISOString(),
      ...options
    };

    this.kb.set(key, updatedEntry);

    // Update indices
    if (options.category && options.category !== entry.category) {
      // Remove from old category
      const oldCategory = this.categories.get(entry.category);
      if (oldCategory) {
        oldCategory.delete(key);
      }

      // Add to new category
      if (!this.categories.has(options.category)) {
        this.categories.set(options.category, new Map());
      }
      this.categories.get(options.category).set(key, updatedEntry);
    }

    this.emit('entryUpdated', { key });

    return {
      success: true,
      key
    };
  }

  /**
   * Delete an entry
   */
  delete(key) {
    const entry = this.kb.get(key);

    if (!entry) {
      return false;
    }

    // Remove from category index
    const categoryEntries = this.categories.get(entry.category);
    if (categoryEntries) {
      categoryEntries.delete(key);
    }

    // Remove from tag indices
    entry.tags.forEach(tag => {
      const tagEntries = this.tags.get(tag);
      if (tagEntries) {
        tagEntries.delete(key);
      }
    });

    // Remove relations
    this.relations.delete(key);
    // Also remove incoming relations
    for (const [fromKey, rels] of this.relations) {
      this.relations.set(fromKey, rels.filter(r => r.to !== key));
    }

    // Remove main entry
    this.kb.delete(key);

    this.metrics.totalEntries--;

    this.emit('entryDeleted', { key });

    return true;
  }

  /**
   * Calculate relevance score for search
   */
  calculateRelevance(query, entry) {
    let score = entry.confidence;

    // Boost based on recency
    const age = Date.now() - new Date(entry.updatedAt).getTime();
    const recencyBoost = Math.max(0, 1 - (age / (30 * 24 * 60 * 60 * 1000))); // 30 days
    score += recencyBoost * 0.2;

    // Boost based on access count
    const popularityBoost = Math.min(0.3, entry.accessCount / 1000);
    score += popularityBoost;

    return Math.min(1, score);
  }

  /**
   * Calculate Levenshtein distance (simplified)
   */
  levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Get knowledge base statistics
   */
  getStats() {
    return {
      ...this.metrics,
      categories: Array.from(this.categories.keys()).map(cat => ({
        name: cat,
        count: this.categories.get(cat).size
      })),
      tags: Array.from(this.tags.keys()).map(tag => ({
        name: tag,
        count: this.tags.get(tag).size
      })),
      mostAccessed: this.getMostAccessed(5)
    };
  }

  /**
   * Get most accessed entries
   */
  getMostAccessed(limit = 5) {
    const entries = Array.from(this.kb.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(e => ({
        key: e.key,
        accessCount: e.accessCount,
        category: e.category
      }));

    return entries;
  }

  /**
   * Export knowledge base
   */
  export() {
    return {
      entries: Array.from(this.kb.entries()),
      categories: Array.from(this.categories.entries()).map(([name, entries]) => ({
        name,
        keys: Array.from(entries.keys())
      })),
      tags: Array.from(this.tags.entries()).map(([name, entries]) => ({
        name,
        keys: Array.from(entries.keys())
      })),
      relations: Array.from(this.relations.entries()),
      metrics: this.metrics,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import knowledge base
   */
  import(data) {
    if (data.entries) {
      data.entries.forEach(([key, entry]) => {
        this.kb.set(key, entry);
      });
    }

    if (data.categories) {
      data.categories.forEach(({ name, keys }) => {
        const categoryMap = new Map();
        keys.forEach(key => {
          const entry = this.kb.get(key);
          if (entry) categoryMap.set(key, entry);
        });
        this.categories.set(name, categoryMap);
      });
    }

    if (data.tags) {
      data.tags.forEach(({ name, keys }) => {
        const tagMap = new Map();
        keys.forEach(key => {
          const entry = this.kb.get(key);
          if (entry) tagMap.set(key, entry);
        });
        this.tags.set(name, tagMap);
      });
    }

    if (data.relations) {
      data.relations.forEach(([key, rels]) => {
        this.relations.set(key, rels);
      });
    }

    this.metrics = data.metrics || {
      totalEntries: this.kb.size,
      totalCategories: this.categories.size,
      totalTags: this.tags.size,
      totalRelations: this.relations.size
    };

    this.emit('imported', {
      entries: this.kb.size,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      entries: this.kb.size
    };
  }

  /**
   * Clear knowledge base
   */
  clear() {
    this.kb.clear();
    this.categories.clear();
    this.tags.clear();
    this.relations.clear();

    this.metrics = {
      totalEntries: 0,
      totalCategories: 0,
      totalTags: 0,
      totalRelations: 0
    };

    this.emit('cleared');

    return {
      success: true,
      message: 'Knowledge base cleared'
    };
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `kb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }
}

module.exports = new KnowledgeBase();
