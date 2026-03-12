/**
 * Vector Database - Store and search vector embeddings
 * Supports multiple backends and similarity search
 */
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class VectorDatabase extends EventEmitter {
  constructor() {
    super();
    
    this.vectors = [];
    this.index = new Map();
    this.storagePath = path.join(__dirname, '../vectors.json');
    
    this.load();
    
    console.log('🧠 Vector database initialized');
  }

  /**
   * Add vector to database
   */
  add(vector, metadata = {}) {
    const id = this.generateId();

    const entry = {
      id,
      vector: vector.values || vector,
      metadata: {
        ...metadata,
        addedAt: new Date().toISOString()
      }
    };

    this.vectors.push(entry);
    this.index.set(id, this.vectors.length - 1);

    this.emit('vectorAdded', { id, size: this.vectors.length });

    this.save();

    return {
      success: true,
      id,
      position: this.vectors.length - 1
    };
  }

  /**
   * Add multiple vectors
   */
  addMany(vectors) {
    const results = [];

    for (const v of vectors) {
      results.push(this.add(v.vector, v.metadata));
    }

    return results;
  }

  /**
   * Search for similar vectors
   */
  search(query, limit = 10, threshold = 0.5) {
    const queryVector = query.values || query;

    const results = this.vectors
      .map(item => ({
        id: item.id,
        score: this.cosineSimilarity(queryVector, item.vector),
        metadata: item.metadata
      }))
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      success: true,
      count: results.length,
      results
    };
  }

  /**
   * Get vector by ID
   */
  get(id) {
    const position = this.index.get(id);
    
    if (position === undefined) {
      return null;
    }

    return this.vectors[position];
  }

  /**
   * Update vector
   */
  update(id, vector, metadata = {}) {
    const position = this.index.get(id);
    
    if (position === undefined) {
      return { success: false, error: 'Vector not found' };
    }

    this.vectors[position] = {
      id,
      vector: vector.values || vector,
      metadata: {
        ...this.vectors[position].metadata,
        ...metadata,
        updatedAt: new Date().toISOString()
      }
    };

    this.save();

    return {
      success: true,
      id
    };
  }

  /**
   * Delete vector
   */
  delete(id) {
    const position = this.index.get(id);
    
    if (position === undefined) {
      return { success: false, error: 'Vector not found' };
    }

    this.vectors.splice(position, 1);
    this.index.delete(id);

    // Rebuild index
    this.rebuildIndex();

    this.save();

    return {
      success: true,
      id
    };
  }

  /**
   * Calculate cosine similarity
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
   * Rebuild index
   */
  rebuildIndex() {
    this.index.clear();
    this.vectors.forEach((item, idx) => {
      this.index.set(item.id, idx);
    });
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      totalVectors: this.vectors.length,
      dimensions: this.vectors[0]?.vector.length || 0,
      indexSize: this.index.size
    };
  }

  /**
   * List all vectors (with pagination)
   */
  list(limit = 100, offset = 0) {
    const vectors = this.vectors
      .slice(offset, offset + limit)
      .map(v => ({
        id: v.id,
        metadata: v.metadata
      }));

    return {
      success: true,
      total: this.vectors.length,
      offset,
      limit,
      vectors
    };
  }

  /**
   * Clear database
   */
  clear() {
    this.vectors = [];
    this.index.clear();
    this.save();

    return { success: true };
  }

  /**
   * Save to disk
   */
  async save() {
    try {
      const data = {
        vectors: this.vectors,
        index: Array.from(this.index.entries())
      };
      
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
      
    } catch (error) {
      console.error('Failed to save vectors:', error);
    }
  }

  /**
   * Load from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.vectors = parsed.vectors || [];
      this.index = new Map(parsed.index || []);
      
      console.log(`📦 Loaded ${this.vectors.length} vectors from storage`);
      
    } catch {
      console.log('No existing vectors found, starting fresh');
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new VectorDatabase();
