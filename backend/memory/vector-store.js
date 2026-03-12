/**
 * Vector Store - In-memory vector database for AI memory
 * Implements vector storage, similarity search, and CRUD operations
 */
class VectorStore {
  constructor() {
    this.vectors = [];
    this.index = new Map(); // For fast lookups by ID
    this.dimensions = 0;
    this.metrics = {
      totalVectors: 0,
      searchesPerformed: 0,
      averageSearchTime: 0
    };
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) {
      return 0;
    }

    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);

    if (magA === 0 || magB === 0) return 0;

    return dot / (magA * magB);
  }

  /**
   * Calculate Euclidean distance between vectors
   */
  euclideanDistance(a, b) {
    if (!a || !b || a.length !== b.length) {
      return Infinity;
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
  }

  /**
   * Add a vector to the store
   */
  addVector(id, vector, metadata = {}) {
    // Validate inputs
    if (!id || typeof id !== 'string') {
      throw new Error('Vector ID must be a non-empty string');
    }

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('Vector must be a non-empty array');
    }

    // Check for duplicate ID
    if (this.index.has(id)) {
      throw new Error(`Vector with ID ${id} already exists`);
    }

    // Set dimensions based on first vector
    if (this.vectors.length === 0) {
      this.dimensions = vector.length;
    } else if (vector.length !== this.dimensions) {
      throw new Error(`Vector dimension mismatch. Expected ${this.dimensions}, got ${vector.length}`);
    }

    const vectorEntry = {
      id,
      vector,
      metadata: {
        ...metadata,
        createdAt: metadata.createdAt || new Date().toISOString()
      }
    };

    this.vectors.push(vectorEntry);
    this.index.set(id, this.vectors.length - 1);
    this.metrics.totalVectors = this.vectors.length;

    return {
      success: true,
      id,
      dimensions: vector.length,
      index: this.vectors.length - 1
    };
  }

  /**
   * Add multiple vectors at once
   */
  addVectors(vectors) {
    const results = [];
    for (const v of vectors) {
      try {
        results.push(this.addVector(v.id, v.vector, v.metadata));
      } catch (error) {
        results.push({ success: false, error: error.message, id: v.id });
      }
    }
    return results;
  }

  /**
   * Search for similar vectors
   */
  search(queryVector, options = {}) {
    const startTime = Date.now();

    const {
      topK = 3,
      threshold = 0.5,
      includeVectors = false,
      metric = 'cosine' // 'cosine' or 'euclidean'
    } = options;

    // Validate query vector
    if (!Array.isArray(queryVector)) {
      throw new Error('Query vector must be an array');
    }

    if (this.vectors.length === 0) {
      return {
        success: true,
        results: [],
        count: 0,
        message: 'No vectors in store'
      };
    }

    if (queryVector.length !== this.dimensions) {
      throw new Error(`Query vector dimension mismatch. Expected ${this.dimensions}, got ${queryVector.length}`);
    }

    // Calculate scores
    const scores = this.vectors.map(item => {
      let score;
      if (metric === 'cosine') {
        score = this.cosineSimilarity(queryVector, item.vector);
      } else {
        // Convert distance to similarity (1 / (1 + distance))
        const distance = this.euclideanDistance(queryVector, item.vector);
        score = 1 / (1 + distance);
      }

      return {
        id: item.id,
        metadata: item.metadata,
        score,
        ...(includeVectors && { vector: item.vector })
      };
    });

    // Filter by threshold and sort
    const results = scores
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Update metrics
    const searchTime = Date.now() - startTime;
    this.metrics.searchesPerformed++;
    this.metrics.averageSearchTime = 
      (this.metrics.averageSearchTime * (this.metrics.searchesPerformed - 1) + searchTime) / 
      this.metrics.searchesPerformed;

    return {
      success: true,
      results,
      count: results.length,
      searchTime,
      metric,
      threshold
    };
  }

  /**
   * Get vector by ID
   */
  getVector(id) {
    const index = this.index.get(id);
    if (index === undefined) {
      return null;
    }
    return this.vectors[index];
  }

  /**
   * Update vector metadata
   */
  updateVector(id, metadata) {
    const index = this.index.get(id);
    if (index === undefined) {
      return { success: false, error: 'Vector not found' };
    }

    this.vectors[index].metadata = {
      ...this.vectors[index].metadata,
      ...metadata,
      updatedAt: new Date().toISOString()
    };

    return {
      success: true,
      id,
      metadata: this.vectors[index].metadata
    };
  }

  /**
   * Delete vector by ID
   */
  deleteVector(id) {
    const index = this.index.get(id);
    if (index === undefined) {
      return { success: false, error: 'Vector not found' };
    }

    // Remove from array
    this.vectors.splice(index, 1);
    
    // Rebuild index
    this.index.clear();
    this.vectors.forEach((v, i) => {
      this.index.set(v.id, i);
    });

    this.metrics.totalVectors = this.vectors.length;

    return {
      success: true,
      id,
      remainingVectors: this.vectors.length
    };
  }

  /**
   * Get all vectors
   */
  getAll(includeVectors = false) {
    if (includeVectors) {
      return this.vectors;
    }
    return this.vectors.map(v => ({
      id: v.id,
      metadata: v.metadata,
      dimensions: v.vector.length
    }));
  }

  /**
   * Get vectors by metadata filter
   */
  filterByMetadata(filter) {
    return this.vectors.filter(item => {
      for (const [key, value] of Object.entries(filter)) {
        if (item.metadata[key] !== value) {
          return false;
        }
      }
      return true;
    }).map(v => ({
      id: v.id,
      metadata: v.metadata,
      score: 1.0
    }));
  }

  /**
   * Search by text (requires text-to-vector conversion)
   * Simple implementation - in production use embeddings API
   */
  searchByText(text, options = {}) {
    // Convert text to simple vector (hash-based)
    // This is a simplistic approach - real systems use embeddings
    const words = text.toLowerCase().split(/\s+/);
    const vector = new Array(this.dimensions || 10).fill(0);
    
    words.forEach((word, idx) => {
      const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      vector[idx % vector.length] += hash / 1000;
    });

    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return this.search(vector, options);
  }

  /**
   * Get similar items to a given ID
   */
  getSimilar(id, options = {}) {
    const vector = this.getVector(id);
    if (!vector) {
      return { success: false, error: 'Vector not found' };
    }

    const results = this.search(vector.vector, {
      ...options,
      topK: (options.topK || 3) + 1 // Add 1 to exclude the query itself
    });

    // Filter out the query vector
    results.results = results.results.filter(r => r.id !== id);
    
    return results;
  }

  /**
   * Get store statistics
   */
  getStats() {
    return {
      totalVectors: this.vectors.length,
      dimensions: this.dimensions,
      metrics: this.metrics,
      memoryUsage: this.estimateMemoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  estimateMemoryUsage() {
    let totalSize = 0;
    
    for (const v of this.vectors) {
      // Vector numbers (8 bytes each)
      totalSize += v.vector.length * 8;
      
      // Metadata size (rough)
      totalSize += JSON.stringify(v.metadata).length * 2;
      
      // ID size
      totalSize += v.id.length * 2;
    }
    
    return {
      bytes: totalSize,
      megabytes: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }

  /**
   * Clear all vectors
   */
  clear() {
    this.vectors = [];
    this.index.clear();
    this.dimensions = 0;
    this.metrics.totalVectors = 0;
    
    return {
      success: true,
      message: 'Vector store cleared'
    };
  }

  /**
   * Export store to JSON
   */
  export() {
    return {
      dimensions: this.dimensions,
      vectors: this.vectors,
      metrics: this.metrics,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import vectors from JSON
   */
  import(data) {
    if (!data.vectors || !Array.isArray(data.vectors)) {
      throw new Error('Invalid import data');
    }

    let imported = 0;
    let errors = 0;

    for (const v of data.vectors) {
      try {
        this.addVector(v.id, v.vector, v.metadata);
        imported++;
      } catch (error) {
        console.error(`Failed to import vector ${v.id}:`, error);
        errors++;
      }
    }

    return {
      success: true,
      imported,
      errors,
      totalVectors: this.vectors.length
    };
  }

  /**
   * Batch search multiple queries
   */
  batchSearch(queries, options = {}) {
    return queries.map(query => ({
      query,
      results: this.search(query, options)
    }));
  }

  /**
   * Find the centroid of all vectors
   */
  calculateCentroid() {
    if (this.vectors.length === 0) {
      return null;
    }

    const centroid = new Array(this.dimensions).fill(0);
    
    for (const v of this.vectors) {
      for (let i = 0; i < this.dimensions; i++) {
        centroid[i] += v.vector[i];
      }
    }

    for (let i = 0; i < this.dimensions; i++) {
      centroid[i] /= this.vectors.length;
    }

    return centroid;
  }
}

// Create singleton instance
const vectorStore = new VectorStore();

// Export both the class and singleton instance
module.exports = vectorStore;
module.exports.VectorStore = VectorStore;
