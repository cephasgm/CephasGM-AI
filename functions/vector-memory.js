// functions/vector-memory.js

const memory = [];

/**
 * Save vector embedding
 */
function addVector(id, vector, metadata = {}) {

  memory.push({
    id,
    vector,
    metadata
  });

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
      metadata: item.metadata
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return results;

}

module.exports = {
  addVector,
  search
};
