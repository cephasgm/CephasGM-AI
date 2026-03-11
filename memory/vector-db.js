/**
 * Vector Database - Store and search vector embeddings
 */
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class VectorDatabase {
  constructor() {
    this.vectors = [];
    this.index = new Map();
    this.storagePath = path.join(__dirname, '../../vectors.json');
    this.dbType = config.vectorDbType || 'memory';
    
    this.initDatabase();
  }

  /**
   * Initialize database
   */
  async initDatabase() {
    try {
      if (this.dbType === 'memory') {
        await this.loadFromFile();
      } else if (this.dbType === 'pinecone') {
        await this.initPinecone();
      }
      console.log(`Vector database initialized (${this.dbType})`);
    } catch (error) {
      console.error('Failed to initialize vector database:', error);
    }
  }

  /**
   * Load vectors from file (for memory mode)
   */
  async loadFromFile() {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      this.vectors = JSON.parse(data);
      this.buildIndex();
      console.log(`Loaded ${this.vectors.length} vectors from storage`);
    } catch {
      console.log('No existing vectors found, starting fresh');
    }
  }

  /**
   * Save vectors to file
   */
  async saveToFile() {
    try {
      await fs.writeFile(this.storagePath, JSON.stringify(this.vectors, null, 2));
    } catch (error) {
      console.error('Failed to save vectors:', error);
    }
  }

  /**
   * Initialize Pinecone client
   */
  async initPinecone() {
    try {
      const { Pinecone } = require('@pinecone-database/pinecone');
      this.pinecone = new Pinecone({
        apiKey: config.pineconeKey
      });
      
      this.index = this.pinecone.Index('cephasgm');
      console.log('Pinecone initialized');
    } catch (error) {
      console.error('Failed to initialize Pinecone, falling back to memory:', error);
      this.dbType = 'memory';
    }
  }

  /**
   * Build in-memory index
   */
  buildIndex() {
    this.index.clear();
    this.vectors.forEach((vector, idx) => {
      this.index.set(vector.id, idx);
    });
  }

  /**
   * Store vector
   */
  async store(vector, metadata = {}) {
    try {
      if (!vector || !vector.id || !vector.values) {
        throw new Error('Vector must have id and values');
      }

      const vectorData = {
        id: vector.id,
        values: vector.values,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        }
      };

      if (this.dbType === 'pinecone') {
        await this.index.upsert([vectorData]);
      } else {
        // Memory mode
        const existingIdx = this.index.get(vector.id);
        if (existingIdx !== undefined) {
          this.vectors[existingIdx] = vectorData;
        } else {
          this.vectors.push(vectorData);
          this.index.set(vector.id, this.vectors.length - 1);
        }
        await this.saveToFile();
      }

      return {
        success: true,
        id: vector.id,
        stored: true
      };

    } catch (error) {
      console.error('Vector store error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Search for similar vectors
   */
  async search(vector, limit = 10, threshold = 0.5) {
    try {
      if (!vector || !vector.values) {
        throw new Error('Search vector must have values');
      }

      if (this.dbType === 'pinecone') {
        return await this.pineconeSearch(vector.values, limit, threshold);
      } else {
        return this.memorySearch(vector.values, limit, threshold);
      }

    } catch (error) {
      console.error('Vector search error:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Search in memory mode
   */
  memorySearch(queryVector, limit, threshold) {
    const results = this.vectors
      .map(item => ({
        id: item.id,
        score: this.cosineSimilarity(queryVector, item.values),
        metadata: item.metadata
      }))
      .filter(item => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      success: true,
      results,
      count: results.length
    };
  }

  /**
   * Search in Pinecone
   */
  async pineconeSearch(queryVector, limit, threshold) {
    const response = await this.index.query({
      vector: queryVector,
      topK: limit,
      includeMetadata: true
    });

    const results = response.matches
      .filter(match => match.score >= threshold)
      .map(match => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata
      }));

    return {
      success: true,
      results,
      count: results.length
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
   * Delete vector by ID
   */
  async delete(id) {
    try {
      if (!id) {
        throw new Error('Vector ID is required');
      }

      if (this.dbType === 'pinecone') {
        await this.index.delete1({ ids: [id] });
      } else {
        const idx = this.index.get(id);
        if (idx !== undefined) {
          this.vectors.splice(idx, 1);
          this.index.delete(id);
          
          // Rebuild index
          this.buildIndex();
          await this.saveToFile();
        }
      }

      return {
        success: true,
        id,
        deleted: true
      };

    } catch (error) {
      console.error('Vector delete error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get vector by ID
   */
  async get(id) {
    try {
      if (this.dbType === 'pinecone') {
        const response = await this.index.fetch([id]);
        return {
          success: true,
          vector: response.vectors[id]
        };
      } else {
        const idx = this.index.get(id);
        if (idx !== undefined) {
          return {
            success: true,
            vector: this.vectors[idx]
          };
        }
        return {
          success: false,
          error: 'Vector not found'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List all vectors (with pagination)
   */
  async list(limit = 100, offset = 0) {
    try {
      if (this.dbType === 'pinecone') {
        // Pinecone doesn't support listing all vectors directly
        // This is a limitation of the API
        return {
          success: true,
          vectors: [],
          total: 0,
          message: 'Pinecone does not support listing all vectors'
        };
      } else {
        const vectors = this.vectors
          .slice(offset, offset + limit)
          .map(v => ({
            id: v.id,
            metadata: v.metadata
          }));

        return {
          success: true,
          vectors,
          total: this.vectors.length,
          offset,
          limit
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    if (this.dbType === 'pinecone') {
      try {
        const stats = await this.index.describeIndexStats();
        return {
          type: 'pinecone',
          ...stats
        };
      } catch {
        return {
          type: 'pinecone',
          error: 'Failed to get stats'
        };
      }
    } else {
      return {
        type: 'memory',
        vectorCount: this.vectors.length,
        dimension: this.vectors[0]?.values.length || 0
      };
    }
  }

  /**
   * Clear all vectors
   */
  async clear() {
    try {
      if (this.dbType === 'pinecone') {
        // Pinecone delete all not supported directly
        // Would need to delete and recreate index
        return {
          success: false,
          error: 'Clear not supported on Pinecone - use delete individually'
        };
      } else {
        this.vectors = [];
        this.index.clear();
        await this.saveToFile();
        
        return {
          success: true,
          cleared: true
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new VectorDatabase();
