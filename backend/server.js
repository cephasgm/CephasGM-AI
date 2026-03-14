/**
 * Main Server - CephasGM AI Phase 6
 * Updated with intelligent static file serving for Render deployment
 * Added additional routes for frontend compatibility
 * Added Prometheus metrics and Sentry error tracking
 */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const config = require('./config');
const path = require('path');
const fs = require('fs');

// ============================================
// Monitoring & Error Tracking
// ============================================
const promClient = require('prom-client');
const Sentry = require('@sentry/node');

// Initialize Sentry (add DSN to environment variables)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
  console.log('✅ Sentry initialized');
}

// Create a Registry for Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDurationMicroseconds = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [50, 100, 200, 300, 400, 500, 1000, 2000, 3000, 5000]
});
register.registerMetric(httpRequestDurationMicroseconds);

const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestCounter);

// Import AI modules
const chatEngine = require('./ai/chat-engine');
const codeInterpreter = require('./ai/code-interpreter');
const videoGenerator = require('./ai/video-generator');
const modelHost = require('./ai/model-host');

// Import agents
const agentManager = require('../agents/manager');
const researchAgent = require('../agents/research-agent');
const codingAgent = require('../agents/coding-agent');
const automationAgent = require('../agents/automation-agent');

// Import memory modules
const vectorDb = require('./memory/vector-db');
const knowledgeGraph = require('./memory/knowledge-graph');

// Import GPU module
const localInference = require('./gpu/local-inference');

const app = express();
const PORT = config.port;

// ============================================
// CORS Configuration - FIXED for Firebase
// ============================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.options('*', cors());

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// Metrics Middleware (place after CORS, before any routes)
// ============================================
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    httpRequestDurationMicroseconds
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);
    httpRequestCounter
      .labels(req.method, route, res.statusCode.toString())
      .inc();
  });
  next();
});

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'CephasGM AI Phase 3',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    config: {
      nodeEnv: config.nodeEnv,
      gpuAvailable: modelHost.gpuAvailable,
      vectorDb: config.vectorDbType
    }
  });
});

// Metrics endpoint (place before static file handling)
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const result = await chatEngine.chat(prompt, options);
    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// STREAMING CHAT ENDPOINT
// ============================================
app.post('/chat/stream', async (req, res) => {
  try {
    const { prompt, model = 'gpt-3.5-turbo' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const stream = await chatEngine.stream(prompt, { model });
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Research endpoint
app.post('/research', async (req, res) => {
  try {
    const { topic, options } = req.body;
    if (!topic) return res.status(400).json({ error: 'Topic is required' });
    const result = await researchAgent.execute(topic, options);
    res.json(result);
  } catch (error) {
    console.error('Research error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Code execution endpoint
app.post('/code', async (req, res) => {
  try {
    const { code, options } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    const result = await codeInterpreter.run(code, options);
    res.json(result);
  } catch (error) {
    console.error('Code execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Video generation endpoint
app.post('/video', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const result = await videoGenerator.create(prompt, options);
    res.json(result);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Agent task routing endpoint
app.post('/task', async (req, res) => {
  try {
    const { task, params } = req.body;
    if (!task) return res.status(400).json({ error: 'Task is required' });
    const result = await agentManager.route(task, params);
    res.json(result);
  } catch (error) {
    console.error('Agent routing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vector memory endpoints
app.post('/memory/store', async (req, res) => {
  try {
    const { vector, metadata } = req.body;
    if (!vector) return res.status(400).json({ error: 'Vector is required' });
    const result = await vectorDb.store(vector, metadata);
    res.json(result);
  } catch (error) {
    console.error('Vector store error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/memory/search', async (req, res) => {
  try {
    const { vector, limit = 10, threshold = 0.5 } = req.body;
    if (!vector) return res.status(400).json({ error: 'Vector is required' });
    const results = await vectorDb.search(vector, limit, threshold);
    res.json(results);
  } catch (error) {
    console.error('Vector search error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/memory/vectors', async (req, res) => {
  try {
    const stats = vectorDb.getStats ? vectorDb.getStats() : { totalVectors: 0 };
    let vectors = [];
    try {
      if (typeof vectorDb.getRecent === 'function') {
        vectors = await vectorDb.getRecent(20);
      }
    } catch (e) {
      console.log('Could not get recent vectors:', e.message);
    }
    res.json({ success: true, vectors, stats, message: 'Vector memory endpoint' });
  } catch (error) {
    console.error('Error getting memory vectors:', error);
    res.status(500).json({ success: false, error: error.message, vectors: [] });
  }
});

// Knowledge graph endpoints
app.post('/graph/add', async (req, res) => {
  try {
    const { entity, relation, target, properties } = req.body;
    if (!entity || !relation || !target) {
      return res.status(400).json({ error: 'Entity, relation, and target are required' });
    }
    const result = knowledgeGraph.addRelation(entity, relation, target, properties);
    res.json(result);
  } catch (error) {
    console.error('Graph add error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/graph/query', async (req, res) => {
  try {
    const { entity, depth = 1 } = req.query;
    if (!entity) return res.status(400).json({ error: 'Entity is required' });
    const results = knowledgeGraph.query(entity, parseInt(depth));
    res.json(results);
  } catch (error) {
    console.error('Graph query error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GPU inference endpoint
app.post('/gpu/infer', async (req, res) => {
  try {
    const { prompt, model = 'llama3' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const result = await localInference.run(prompt, model);
    res.json(result);
  } catch (error) {
    console.error('GPU inference error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Model hosting endpoints
app.get('/models', (req, res) => {
  const status = modelHost.getStatus();
  res.json(status);
});

app.post('/models/load', async (req, res) => {
  try {
    const { modelName, options } = req.body;
    if (!modelName) return res.status(400).json({ error: 'Model name is required' });
    const result = await modelHost.loadModel(modelName, options);
    res.json(result);
  } catch (error) {
    console.error('Model load error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/models/infer', async (req, res) => {
  try {
    const { modelName, input, options } = req.body;
    if (!modelName || !input) return res.status(400).json({ error: 'Model name and input are required' });
    const result = await modelHost.infer(modelName, input, options);
    res.json(result);
  } catch (error) {
    console.error('Model inference error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List agents endpoint
app.get('/agents', (req, res) => {
  const agents = agentManager.listAgents();
  res.json(agents);
});

// ============================================
// ADDITIONAL ROUTES FOR FRONTEND COMPATIBILITY
// ============================================

app.post('/generate/image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    let result;
    try {
      const imageEngine = require('./multimodal/image-engine');
      result = await imageEngine.generate(prompt);
    } catch (e) {
      console.log('Image engine not available, using fallback');
      result = {
        url: `https://via.placeholder.com/512x512.png?text=${encodeURIComponent(prompt.substring(0, 30))}`,
        simulated: true
      };
    }
    res.json(result);
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Upload endpoint ready',
      fileName: req.body.filename || 'unknown',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/generate/audio', async (req, res) => {
  try {
    const { text, options } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    let result;
    try {
      const audioEngine = require('./multimodal/audio-engine');
      result = await audioEngine.generate(text, options);
    } catch (e) {
      console.log('Audio engine not available, using fallback');
      result = {
        url: `https://storage.cephasgm.ai/audio/simulated.mp3`,
        duration: text.length / 15,
        simulated: true
      };
    }
    res.json(result);
  } catch (error) {
    console.error('Audio generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/task/enhanced', async (req, res) => {
  try {
    const { task, options = {} } = req.body;
    if (!task) return res.status(400).json({ error: 'Task is required' });
    const agentType = options.agentType || 'auto';
    const startTime = Date.now();
    let result;
    try {
      const taskLower = task.toLowerCase();
      if (agentType === 'search' || taskLower.includes('search') || taskLower.includes('find')) {
        const researchAgent = require('../agents/research-agent');
        result = await researchAgent.execute(task);
      } else if (agentType === 'coding' || taskLower.includes('code') || taskLower.includes('function') || taskLower.includes('program')) {
        const codeInterpreter = require('./ai/code-interpreter');
        result = await codeInterpreter.run(task);
      } else if (agentType === 'translate' || taskLower.includes('translate')) {
        try {
          const textEngine = require('./multimodal/text-engine');
          result = await textEngine.translate(task.replace(/translate/i, '').trim(), 'english');
        } catch (e) {
          result = { message: `Translation simulation: ${task}` };
        }
      } else if (agentType === 'summarize' || taskLower.includes('summarize')) {
        try {
          const textEngine = require('./multimodal/text-engine');
          result = await textEngine.summarize(task.replace(/summarize/i, '').trim());
        } catch (e) {
          result = { summary: `Summary simulation for: ${task}` };
        }
      } else {
        result = await agentManager.route(task, options);
      }
    } catch (e) {
      console.error('Agent routing error:', e);
      result = {
        success: true,
        message: `Task processed: ${task}`,
        note: 'Using fallback response',
        timestamp: new Date().toISOString()
      };
    }
    const executionTime = Date.now() - startTime;
    res.json({ success: true, agent: agentType, task, result, executionTime: `${executionTime}ms`, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Task routing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// INTELLIGENT STATIC FILE SERVING
// =============================================
console.log('🔍 Looking for frontend files...');
const possiblePaths = [
  path.join(__dirname, '../frontend'),
  path.join(__dirname, '..'),
  path.join(__dirname, '../../frontend'),
  path.join(__dirname, '../public'),
  path.join(process.cwd(), 'frontend'),
  path.join(process.cwd(), 'public')
];
let staticPath = null;
for (const testPath of possiblePaths) {
  const indexPath = path.join(testPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    staticPath = testPath;
    console.log(`✅ Frontend found at: ${staticPath}`);
    console.log(`📄 index.html exists: ${indexPath}`);
    const hasManifest = fs.existsSync(path.join(testPath, 'manifest.json'));
    const hasSw = fs.existsSync(path.join(testPath, 'sw.js'));
    const hasAssets = fs.existsSync(path.join(testPath, 'assets'));
    if (hasManifest) console.log('📱 manifest.json found');
    if (hasSw) console.log('🔄 service worker found');
    if (hasAssets) console.log('🎨 assets folder found');
    break;
  }
}
if (staticPath) {
  app.use(express.static(staticPath));
  console.log(`📁 Serving static files from: ${staticPath}`);
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || 
        req.path === '/health' || 
        req.path === '/agents' ||
        req.path === '/models' ||
        req.path.startsWith('/memory/') ||
        req.path.startsWith('/graph/') ||
        req.path.startsWith('/generate/') ||
        req.path === '/upload' ||
        req.path === '/task' ||
        req.path === '/chat/stream') {
      return next();
    }
    const requestedFile = path.join(staticPath, req.path);
    if (fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
      return res.sendFile(requestedFile);
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
  console.log('✅ SPA catch-all route configured');
} else {
  console.log('⚠️ No frontend files found - running in API-only mode');
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || 
        req.path === '/agents' || 
        req.path === '/models' ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/memory/') ||
        req.path.startsWith('/graph/') ||
        req.path.startsWith('/generate/') ||
        req.path === '/upload' ||
        req.path === '/task' ||
        req.path === '/chat/stream') {
      return next();
    }
    res.status(404).json({ 
      success: false,
      error: 'Frontend not found',
      message: 'API server is running, but frontend files are missing.',
      endpoints: {
        health: '/health',
        agents: '/agents',
        models: '/models',
        chat: 'POST /chat',
        'chat/stream': 'POST /chat/stream',
        research: 'POST /research',
        code: 'POST /code',
        video: 'POST /video',
        task: 'POST /task',
        'task/enhanced': 'POST /task/enhanced',
        'generate/image': 'POST /generate/image',
        'generate/audio': 'POST /generate/audio',
        upload: 'POST /upload',
        memory: '/memory/*',
        graph: '/graph/*',
        gpu: '/gpu/infer'
      },
      documentation: 'https://github.com/cephasgm/CephasGM-AI'
    });
  });
  console.log('ℹ️ API-only mode: All non-API routes will return JSON with endpoint list');
}

// ============================================
// Sentry Error Handler (after all routes, before other error handlers)
// ============================================
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: config.isProduction() ? 'An error occurred' : err.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀 CephasGM AI Phase 6 Server Running                 ║
║   📍 Port: ${PORT}                                          ║
║   🌍 Environment: ${config.nodeEnv.padEnd(15)}                   ║
║   🎯 Features: Chat, Research, Code, Video, Agents      ║
║   💾 Vector DB: ${config.vectorDbType.padEnd(15)}                   ║
║   🖥️ GPU: ${modelHost.gpuAvailable ? '✅ Available' : '❌ Not Available'}                 ║
║   📁 Frontend: ${staticPath ? '✅ Found' : '❌ Not Found'}                 ║
║   📊 Mode: ${staticPath ? 'Full Stack' : 'API Only'}                      ║
║   🌐 CORS: ✅ Configured for Firebase                      ║
║   🆕 Added Routes: Image, Audio, Upload, Enhanced Tasks   ║
║   🆕 Streaming: ✅ /chat/stream enabled                    ║
║   📈 Monitoring: ✅ /metrics enabled, Sentry ready         ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
  if (!staticPath) {
    console.log(`
📝 API-ONLY MODE:
   Your API is live at: https://cephasgm-ai.onrender.com
   Available endpoints:
   • GET  /health          - System status
   • GET  /agents          - List all agents
   • GET  /models          - List available models
   • POST /chat            - Chat with AI
   • POST /chat/stream     - Streaming chat
   • POST /research        - Research topics
   • POST /code            - Execute code
   • POST /video           - Generate video
   • POST /task            - Route agent tasks
   • POST /task/enhanced   - Enhanced task routing
   • POST /generate/image  - Generate images
   • POST /generate/audio  - Generate audio
   • POST /upload          - Upload files
   • POST /memory/*        - Vector memory operations
   • POST /graph/*         - Knowledge graph operations
    `);
  }
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await modelHost.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await modelHost.shutdown();
  process.exit(0);
});

module.exports = app;
