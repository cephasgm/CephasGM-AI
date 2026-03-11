const functions = require("firebase-functions")

// In-memory vector store
const memory = [];

/**
 * Save vector embedding
 */
function addVector(id, vector, metadata = {}) {

  memory.push({
    id,
    vector,
    metadata,
    timestamp: Date.now()
  });
  
  return { success: true, id };

}

/**
 * Cosine similarity
 */
function similarity(a, b) {

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
 * Search similar vectors
 */
function search(vector, limit = 5) {

  const results = memory
    .map(item => ({
      id: item.id,
      score: similarity(vector, item.vector),
      metadata: item.metadata,
      timestamp: item.timestamp
    }))
    .filter(item => item.score > 0.5) // Only return similar items
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;

}

// HTTP endpoint for vector operations
exports.vectorMemory = functions.https.onRequest(async(req,res)=>{

// Enable CORS
res.set('Access-Control-Allow-Origin', '*')
res.set('Access-Control-Allow-Methods', 'POST, GET')
res.set('Access-Control-Allow-Headers', 'Content-Type')

if (req.method === 'OPTIONS') {
  res.status(204).send('')
  return
}

try {
  const action = req.body.action || req.query.action

  if (action === 'add') {
    const { id, vector, metadata } = req.body
    const result = addVector(id, vector, metadata)
    res.json(result)
    
  } else if (action === 'search') {
    const { vector, limit } = req.body
    const results = search(vector, limit || 5)
    res.json({ results })
    
  } else {
    res.json({ 
      memory: memory.map(m => ({ id: m.id, metadata: m.metadata, timestamp: m.timestamp }))
    })
  }

} catch(error) {
  console.error("Vector memory error:", error)
  res.status(500).json({error: error.message})
}

})

module.exports = {
  addVector,
  search
}
