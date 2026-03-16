const functions = require("firebase-functions");

// In-memory vector storage
let memoryStore = [];
let memoryId = 0;

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
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
 * Generate a simple vector from text (simplified for demo)
 * In production, use OpenAI embeddings or similar
 */
function textToVector(text) {
  // This is a simplified hash-based vector for demo purposes
  // In production, replace with actual embeddings API
  const words = text.toLowerCase().split(/\s+/);
  const vector = new Array(10).fill(0);
  
  words.forEach((word, idx) => {
    const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    vector[idx % 10] += hash / 1000;
  });
  
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

/**
 * Vector Memory API
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory
 */
exports.vectorMemory = functions.https.onRequest(async (req, res) => {
  // Set CORS headers for all responses
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight (OPTIONS) immediately
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    // GET request - return all memories
    if (req.method === 'GET') {
      res.json({
        success: true,
        count: memoryStore.length,
        memories: memoryStore.map(m => ({
          id: m.id,
          metadata: m.metadata,
          timestamp: m.timestamp
        }))
      });
      return;
    }

    // POST request - perform action
    if (req.method === 'POST') {
      const { action, text, vector, id, metadata, limit = 5, threshold = 0.5 } = req.body;

      // Validate required fields
      if (!action) {
        res.status(400).json({ error: 'Missing action parameter' });
        return;
      }
      
      // Add vector to memory
      if (action === 'add') {
        let vectorToStore = vector;
        
        // Generate vector from text if not provided
        if (!vectorToStore && text) {
          vectorToStore = textToVector(text);
        }
        
        if (!vectorToStore) {
          res.status(400).json({ error: "Either vector or text is required for add" });
          return;
        }

        const newMemory = {
          id: id || `mem_${++memoryId}`,
          vector: vectorToStore,
          metadata: metadata || { text: text || "" },
          timestamp: Date.now()
        };

        memoryStore.push(newMemory);

        res.json({
          success: true,
          action: "added",
          id: newMemory.id,
          count: memoryStore.length
        });
      }
      
      // Search similar vectors
      else if (action === "search") {
        let searchVector = vector;
        
        // Generate vector from text if not provided
        if (!searchVector && text) {
          searchVector = textToVector(text);
        }
        
        if (!searchVector) {
          res.status(400).json({ error: "Either vector or text is required for search" });
          return;
        }

        // Calculate similarities
        const results = memoryStore
          .map(item => ({
            id: item.id,
            metadata: item.metadata,
            timestamp: item.timestamp,
            similarity: cosineSimilarity(searchVector, item.vector)
          }))
          .filter(item => item.similarity >= threshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        res.json({
          success: true,
          action: "searched",
          query: text || "vector search",
          results: results,
          count: results.length
        });
      }
      
      // Delete vector
      else if (action === "delete") {
        if (!id) {
          res.status(400).json({ error: "ID is required for delete" });
          return;
        }

        const initialLength = memoryStore.length;
        memoryStore = memoryStore.filter(m => m.id !== id);

        res.json({
          success: true,
          action: "deleted",
          id: id,
          deleted: initialLength > memoryStore.length
        });
      }
      
      // Clear all memory
      else if (action === "clear") {
        memoryStore = [];
        memoryId = 0;
        
        res.json({
          success: true,
          action: "cleared",
          message: "All vector memory cleared"
        });
      }
      
      else {
        res.status(400).json({ error: "Invalid action. Use: add, search, delete, clear" });
      }
    } else {
      res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    }
  } catch (error) {
    console.error("Vector memory error:", error);
    res.status(500).json({ 
      error: "Vector memory operation failed", 
      details: error.message 
    });
  }
});
