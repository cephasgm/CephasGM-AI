/**
 * Main Server - CephasGM AI Phase 3
 */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const config = require('./config');
const path = require('path');

// Import AI modules
const chatEngine = require('./ai/chat-engine');
const codeInterpreter = require('./ai/code-interpreter');
const videoGenerator = require('./ai/video-generator');
const modelHost = require('./ai/model-host');

// Import agents
const agentManager = require('./agents/manager');
const researchAgent = require('./agents/research-agent');
const codingAgent = require('./agents/coding-agent');
const automationAgent = require('./agents/automation-agent');

// Import memory modules
const vectorDb = require('./memory/vector-db');
const knowledgeGraph = require('./memory/knowledge-graph');

// Import GPU module
const localInference = require('./gpu/local-inference');

const app = express();
const PORT = config.port;

// Middleware
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

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

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const result = await chatEngine.chat(prompt, options);
    res.json(result);

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Research endpoint
app.post('/research', async (req, res) => {
  try {
    const { topic, options } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

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
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

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
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

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
    
    if (!task) {
      return res.status(400).json({ error: 'Task is required' });
    }

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
    
    if (!vector) {
      return res.status(400).json({ error: 'Vector is required' });
    }

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
    
    if (!vector) {
      return res.status(400).json({ error: 'Vector is required' });
    }

    const results = await vectorDb.search(vector, limit, threshold);
    res.json(results);

  } catch (error) {
    console.error('Vector search error:', error);
    res.status(500).json({ error: error.message });
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
    
    if (!entity) {
      return res.status(400).json({ error: 'Entity is required' });
    }

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
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

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
    
    if (!modelName) {
      return res.status(400).json({ error: 'Model name is required' });
    }

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
    
    if (!modelName || !input) {
      return res.status(400).json({ error: 'Model name and input are required' });
    }

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

// Serve static files (for frontend)
app.use(express.static(path.join(__dirname, '../frontend')));

// Catch-all route for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.isProduction() ? 'An error occurred' : err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀 CephasGM AI Phase 3 Server Running                 ║
║   📍 Port: ${PORT}                                          ║
║   🌍 Environment: ${config.nodeEnv.padEnd(15)}                   ║
║   🎯 Features: Chat, Research, Code, Video, Agents      ║
║   💾 Vector DB: ${config.vectorDbType.padEnd(15)}                   ║
║   🖥️ GPU: ${modelHost.gpuAvailable ? '✅ Available' : '❌ Not Available'}                 ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  modelHost.shutdown().then(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  modelHost.shutdown().then(() => {
    process.exit(0);
  });
});

module.exports = app;
