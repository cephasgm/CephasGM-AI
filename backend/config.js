/**
 * Configuration - Environment variables and API keys
 */
const path = require('path');

// Simple config without dotenv dependency
module.exports = {
  // Server configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // API Keys (with defaults)
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
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // CORS
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
  sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 86400000, // 24 hours
  
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
    const config = { ...this };
    // Don't include functions in getAll
    delete config.get;
    delete config.isProduction;
    delete config.isDevelopment;
    delete config.getAll;
    return config;
  }
};
