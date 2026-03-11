/**
 * Configuration - Environment variables and API keys
 */
const dotenv = require('dotenv');
const path = require('path');

// Load .env file if exists
try {
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch (error) {
  console.log('No .env file found, using defaults');
}

module.exports = {
  // Server configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // API Keys
  openaiApiKey: process.env.OPENAI_KEY || 'YOUR_OPENAI_API_KEY',
  runwayApiKey: process.env.RUNWAY_KEY || 'YOUR_RUNWAY_API_KEY',
  pineconeKey: process.env.PINECONE_KEY || 'YOUR_PINECONE_KEY',
  stabilityApiKey: process.env.STABILITY_KEY || 'YOUR_STABILITY_KEY',
  
  // Model hosting
  gpuNodeCommand: process.env.GPU_NODE_CMD || 'ollama run llama3',
  localModelPath: process.env.LOCAL_MODEL_PATH || path.join(__dirname, '../models'),
  
  // Database
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cephasgm',
  
  // Vector database
  vectorDbType: process.env.VECTOR_DB || 'memory', // 'pinecone', 'memory', 'qdrant'
  
  // Feature flags
  enableGpuInference: process.env.ENABLE_GPU === 'true' || false,
  enableLocalModels: process.env.ENABLE_LOCAL_MODELS === 'true' || true,
  
  // Rate limiting
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW || 60000,
  rateLimitMax: process.env.RATE_LIMIT_MAX || 100,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  sessionTimeout: process.env.SESSION_TIMEOUT || 86400000, // 24 hours
  
  // Get configuration value
  get(key) {
    return this[key];
  },
  
  // Check if in production
  isProduction() {
    return this.nodeEnv === 'production';
  },
  
  // Check if in development
  isDevelopment() {
    return this.nodeEnv === 'development';
  },
  
  // Get all config
  getAll() {
    return { ...this };
  }
};
