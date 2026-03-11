/**
 * Vector Memory
 * Stores and searches vector embeddings with similarity matching
 */
const crypto = require('crypto');
const EventEmitter = require('events');

class VectorMemory extends EventEmitter {
  constructor() {
    super();
    
    this.store = [];
    this.index = new Map();
    this.collections = new Map();
    
    this.metrics = {
      totalVectors: 0,
      collections: 0,
      searchesPerformed: 0,
      averageSearchTime: 0
    };
  }

  /**
   * Add a vector to memory
   */
  add(vector, metadata = {}) {
    if (!vector || !Array.isArray(vector)) {
      throw new Error('Vector must be an array');
    }

    const id = this.generateId();
    
    const item = {
      id,
      vector,
      metadata: {
        ...metadata,
        addedAt: new Date().toISOString()
      },
      collection: metadata.collection || 'default'
    };

    this.store.push(item);
    this.index.set(id, this.store.length - 1);

    // Add to collection
    if (!this.collections.has(item.collection)) {
      this.collections.set(item.collection, []);
    }
    this.collections.get(item.collection).push(id);

    this.metrics.totalVectors++;

    this.emit('vectorAdded', { id, collection: item.collection });

    return id;
  }

  /**
   * Add multiple vectors at once
   */
  addBatch(vectors, metadata = {}) {
    const ids = [];
    
    for (const vector of vectors) {
      const id = this.add(vector, metadata);
      ids.push(id);
    }

    return ids;
  }

  /**
   * Search for similar vectors
   */
  search(queryVector, options = {}) {
    const {
      limit = 10,
      threshold = 0.5,
      collection = null,
      includeVectors = false
    } = options;

    const startTime = Date.now();

    if (!queryVector || !Array.isArray(queryVector)) {
      throw new Error('Query vector must be an array');
    }

    // Filter by collection if specified
    let candidates = this.store;
    if (collection) {
      const collectionIds = this.collections.get(collection) || new Set();
      candidates = this.store.filter(item => collectionIds.has(item.id));
    }

    // Calculate similarities
    const results = candidates
      .map(item => ({
        id: item.id,
        score: this.cosineSimilarity(queryVector, item.vector),
        metadata: item.metadata,
        vector: includeVectors ? item.vector : undefined
      }))
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const searchTime = Date.now() - startTime;

    // Update metrics
    this.metrics.searchesPerformed++;
    this.metrics.averageSearchTime = (this.metrics.averageSearchTime * (this.metrics.searchesPerformed - 1) + searchTime) / this.metrics.searchesPerformed;

    this.emit('searchPerformed', {
      resultCount: results.length,
      searchTime
    });

    return {
      success: true,
      count: results.length,
      results,
      searchTime
    };
  }

  /**
   * Search by text (converts text to vector first)
   */
  async searchByText(text, options = {}) {
    // Simple text to vector conversion (for demo)
    const vector = this.textToVector(text);
    return this.search(vector, options);
  }

  /**
   * Get vector by ID
   */
  get(id) {
    const index = this.index.get(id);
    
    if (index === undefined) {
      return null;
    }

    return this.store[index];
  }

  /**
   * Remove vector by ID
   */
  remove(id) {
    const index = this.index.get(id);
    
    if (index === undefined) {
      return false;
    }

    const item = this.store[index];
    
    // Remove from store
    this.store.splice(index, 1);
    this.index.delete(id);

    // Remove from collection
    if (item.collection) {
      const collection = this.collections.get(item.collection);
      if (collection) {
        const collectionIndex = collection.indexOf(id);
        if (collectionIndex !== -1) {
          collection.splice(collectionIndex, 1);
        }
      }
    }

    // Rebuild index
    this.rebuildIndex();

    this.metrics.totalVectors--;

    this.emit('vectorRemoved', { id, collection: item.collection });

    return true;
  }

  /**
   * Create a collection
   */
  createCollection(name, metadata = {}) {
    if (this.collections.has(name)) {
      throw new Error(`Collection ${name} already exists`);
    }

    this.collections.set(name, []);
    this.metrics.collections++;

    this.emit('collectionCreated', { name, metadata });

    return {
      name,
      metadata,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Get all vectors in a collection
   */
  getCollection(name, options = {}) {
    const { limit = 100, offset = 0 } = options;
    
    const collectionIds = this.collections.get(name) || [];
    const ids = collectionIds.slice(offset, offset + limit);
    
    const vectors = ids
      .map(id => this.get(id))
      .filter(Boolean);

    return {
      name,
      count: vectors.length,
      total: collectionIds.length,
      vectors
    };
  }

  /**
   * Delete a collection
   */
  deleteCollection(name) {
    if (!this.collections.has(name)) {
      return false;
    }

    const ids = this.collections.get(name);
    
    // Remove all vectors in collection
    for (const id of ids) {
      this.remove(id);
    }

    this.collections.delete(name);
    this.metrics.collections--;

    this.emit('collectionDeleted', { name });

    return true;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 0;

    return dotProduct / (magA * magB);
  }

  /**
   * Convert text to simple vector (for demo)
   */
  textToVector(text) {
    const words = text.toLowerCase().split(/\s+/);
    const vector = new Array(100).fill(0);
    
    words.forEach((word, idx) => {
      const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      vector[idx % 100] += hash / 1000;
    });

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }

  /**
   * Rebuild index after removal
   */
  rebuildIndex() {
    this.index.clear();
    this.store.forEach((item, idx) => {
      this.index.set(item.id, idx);
    });
  }

  /**
   * Clear all vectors
   */
  clear() {
    this.store = [];
    this.index.clear();
    this.collections.clear();
    
    this.metrics.totalVectors = 0;
    this.metrics.collections = 0;

    this.emit('cleared');

    return {
      success: true,
      message: 'Vector memory cleared'
    };
  }

  /**
   * Get memory statistics
   */
  getStats() {
    return {
      ...this.metrics,
      vectorDimensions: this.store[0]?.vector.length || 0,
      collections: Array.from(this.collections.keys()).map(name => ({
        name,
        size: this.collections.get(name).length
      }))
    };
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `vec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }
}

module.exports = new VectorMemory();
