/**
 * Main Server - CephasGM AI Phase 6
 * Updated with WebSocket support and enhanced /chat/upload endpoint (PDF, Excel, Word, images).
 */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const config = require('./config');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');           // Excel parsing
const mammoth = require('mammoth');     // Word parsing
const sharp = require('sharp');         // Image dimensions (optional)
const upload = multer({ dest: '/tmp/uploads/' });

// ============================================
// Monitoring & Error Tracking
// ============================================
const promClient = require('prom-client');
const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
  console.log('✅ Sentry initialized');
}

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

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

// ============================================
// Firebase Admin for Role Verification
// ============================================
const admin = require('firebase-admin');

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'cephasgm-ai',
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: 'cephasgm-ai',
    });
  }
  console.log('✅ Firebase Admin initialized');
}

const requireRole = (allowedRoles = []) => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const userRole = decodedToken.role || 'user';
      if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
};

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
// CORS Configuration
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
// Metrics Middleware
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

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Chat endpoint (non-streaming)
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
// STREAMING CHAT ENDPOINT (HTTP)
// ============================================
app.post('/chat/stream', async (req, res) => {
  try {
    const { prompt, model = 'ministral-3-3b' } = req.body;
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

// ============================================
// CHAT WITH FILE UPLOAD ENDPOINT (with PDF, Excel, Word, image parsing)
// ============================================
app.post('/chat/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { prompt, model = 'ministral-3-3b' } = req.body;
    const files = req.files;
    let augmentedPrompt = prompt || '';

    console.log(`📎 Received ${files ? files.length : 0} file(s) for upload`);

    if (files && files.length > 0) {
      augmentedPrompt += '\n\nUser attached the following files:\n';
      for (const file of files) {
        console.log(`📄 Processing file: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`);
        
        // -------------------- PDF --------------------
        if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
          try {
            const dataBuffer = await fs.promises.readFile(file.path);
            console.log(`📄 PDF file size: ${dataBuffer.length} bytes`);
            const pdfData = await pdfParse(dataBuffer);
            const text = pdfData.text;
            console.log(`📄 PDF extracted text length: ${text.length} characters`);
            augmentedPrompt += `\n--- ${file.originalname} (PDF) ---\n${text.substring(0, 5000)}\n`;
          } catch (err) {
            console.error(`Failed to parse PDF ${file.originalname}:`, err);
            augmentedPrompt += `\n- ${file.originalname} (PDF could not be parsed: ${err.message})\n`;
          }
        }
        // -------------------- Excel (.xlsx, .xls) --------------------
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                 file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
          try {
            const workbook = XLSX.readFile(file.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
            console.log(`📊 Excel extracted content length: ${csv.length} characters`);
            augmentedPrompt += `\n--- ${file.originalname} (Excel) ---\n${csv.substring(0, 5000)}\n`;
          } catch (err) {
            console.error(`Failed to parse Excel ${file.originalname}:`, err);
            augmentedPrompt += `\n- ${file.originalname} (Excel could not be parsed: ${err.message})\n`;
          }
        }
        // -------------------- Word (.docx) --------------------
        else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                 file.originalname.endsWith('.docx')) {
          try {
            const result = await mammoth.extractRawText({ path: file.path });
            const text = result.value;
            console.log(`📝 Word extracted text length: ${text.length} characters`);
            augmentedPrompt += `\n--- ${file.originalname} (Word) ---\n${text.substring(0, 5000)}\n`;
          } catch (err) {
            console.error(`Failed to parse Word ${file.originalname}:`, err);
            augmentedPrompt += `\n- ${file.originalname} (Word could not be parsed: ${err.message})\n`;
          }
        }
        // -------------------- Images --------------------
        else if (file.mimetype.startsWith('image/')) {
          try {
            const metadata = await sharp(file.path).metadata();
            console.log(`🖼️ Image dimensions: ${metadata.width}x${metadata.height}`);
            augmentedPrompt += `\n- ${file.originalname} (${file.mimetype}) – ${metadata.width}x${metadata.height} pixels\n`;
          } catch (err) {
            console.error(`Failed to read image ${file.originalname}:`, err);
            augmentedPrompt += `\n- ${file.originalname} (${file.mimetype})\n`;
          }
        }
        // -------------------- Plain text --------------------
        else if (file.mimetype.startsWith('text/') || file.originalname.endsWith('.txt')) {
          try {
            const content = await fs.promises.readFile(file.path, 'utf8');
            console.log(`📄 Text file content length: ${content.length} characters`);
            augmentedPrompt += `\n--- ${file.originalname} ---\n${content}\n`;
          } catch (err) {
            console.error(`Failed to read text file ${file.originalname}:`, err);
            augmentedPrompt += `\n- ${file.originalname} (Text file could not be read)\n`;
          }
        }
        // -------------------- Unknown types --------------------
        else {
          console.log(`⚠️ Unknown file type: ${file.originalname} (${file.mimetype})`);
          augmentedPrompt += `\n- ${file.originalname} (${file.mimetype}) – content not displayed\n`;
        }
        // Clean up temp file
        await fs.promises.unlink(file.path).catch(() => {});
      }
    }

    // If no prompt but only files, we need to ask the AI to analyze
    if (!augmentedPrompt.trim()) {
      augmentedPrompt = "Please analyze the attached file(s).";
    }

    console.log(`📝 Final prompt length: ${augmentedPrompt.length} characters`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await chatEngine.stream(augmentedPrompt, { model });
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('Upload chat error:', error);
    if (!res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
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

// ============================================
// ROLE MANAGEMENT ENDPOINTS
// ============================================
app.get('/user/role', requireRole(), async (req, res) => {
  res.json({ role: req.user.role || 'user' });
});

app.post('/admin/updateRole', requireRole(['admin']), async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: 'Email and role required' });
    }
    const allowedRoles = ['user', 'premium', 'admin'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${allowedRoles.join(', ')}` });
    }
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { role });
    await admin.firestore().collection('users').doc(user.uid).update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ success: true, message: `Role for ${email} updated to ${role}` });
  } catch (error) {
    console.error('Error updating role:', error);
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found' });
    }
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

  const reactAppPath = path.join(staticPath, 'frontend', 'app');
  if (fs.existsSync(reactAppPath)) {
    app.use('/app', express.static(reactAppPath));
    console.log(`📁 React app served from /app at: ${reactAppPath}`);
    app.get('/app/*', (req, res) => {
      res.sendFile(path.join(reactAppPath, 'index.html'));
    });
  } else {
    console.log('⚠️ React app build not found at', reactAppPath);
  }

  // Catch-all for SPA – but skip API, health, metrics, and important routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || 
        req.path === '/health' || 
        req.path === '/agents' ||
        req.path === '/models' ||
        req.path === '/metrics' ||
        req.path.startsWith('/memory/') ||
        req.path.startsWith('/graph/') ||
        req.path.startsWith('/generate/') ||
        req.path === '/upload' ||
        req.path === '/task' ||
        req.path === '/user/role' ||
        req.path === '/admin/updateRole' ||
        req.path === '/chat' ||
        req.path === '/chat/stream' ||
        req.path === '/chat/upload' ||
        req.path.startsWith('/app')) {
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
        req.path === '/metrics' ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/memory/') ||
        req.path.startsWith('/graph/') ||
        req.path.startsWith('/generate/') ||
        req.path === '/upload' ||
        req.path === '/task' ||
        req.path === '/user/role' ||
        req.path === '/admin/updateRole' ||
        req.path === '/chat' ||
        req.path === '/chat/stream' ||
        req.path === '/chat/upload') {
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
        'chat/upload': 'POST /chat/upload (with files)',
        research: 'POST /research',
        code: 'POST /code',
        video: 'POST /video',
        task: 'POST /task',
        'task/enhanced': 'POST /task/enhanced',
        'generate/image': 'POST /generate/image',
        'generate/audio': 'POST /generate/audio',
        memory: '/memory/*',
        graph: '/graph/*',
        gpu: '/gpu/infer',
        'user/role': 'GET /user/role',
        'admin/updateRole': 'POST /admin/updateRole'
      },
      documentation: 'https://github.com/cephasgm/CephasGM-AI'
    });
  });
  console.log('ℹ️ API-only mode: All non-API routes will return JSON with endpoint list');
}

// ============================================
// Sentry Error Handler
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

// ============================================
// Start HTTP server
// ============================================
const server = app.listen(PORT, '0.0.0.0', () => {
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
║   🆕 Added Routes: Image, Audio, Enhanced Tasks            ║
║   📈 Monitoring: ✅ /metrics enabled, Sentry ready         ║
║   🔐 Role Management: ✅ /user/role, /admin/updateRole     ║
║   🔌 WebSocket: ✅ Enabled on same port                    ║
║   🆕 Streaming HTTP: ✅ /chat/stream added                 ║
║   📎 File Upload: ✅ /chat/upload added (PDF, Excel, Word, images) ║
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
   • POST /chat            - Chat with AI (non‑streaming)
   • POST /chat/stream     - Streaming chat (HTTP)
   • POST /chat/upload     - Chat with file uploads (PDF, Excel, Word, images)
   • POST /research        - Research topics
   • POST /code            - Execute code
   • POST /video           - Generate video
   • POST /task            - Route agent tasks
   • POST /task/enhanced   - Enhanced task routing
   • POST /generate/image  - Generate images
   • POST /generate/audio  - Generate audio
   • POST /memory/*        - Vector memory operations
   • POST /graph/*         - Knowledge graph operations
   • GET  /user/role       - Get current user role
   • POST /admin/updateRole - Admin: update user role
   • WebSocket            - wss://cephasgm-ai.onrender.com (for streaming)
    `);
  }
});

// ============================================
// WebSocket Server for real‑time chat (optional)
// ============================================
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'chat') {
        const { prompt, model = 'ministral-3-3b' } = data;
        const stream = await chatEngine.stream(prompt, { model });
        
        for await (const chunk of stream) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(chunk));
          }
        }
        ws.send(JSON.stringify({ done: true }));
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ error: error.message }));
    }
  });

  ws.on('close', () => console.log('🔌 WebSocket client disconnected'));
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.close();
  await modelHost.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  wss.close();
  await modelHost.shutdown();
  process.exit(0);
});

module.exports = app;

