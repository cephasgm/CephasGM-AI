/**
 * API Server - CephasGM AI Phase 5
 * Enterprise-grade REST API for AI infrastructure platform
 */
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const employees = require("../agents/employee-manager");
const gateway = require("../cloud/ai-gateway");
const orchestrator = require("../platform/orchestrator");
const knowledgeBase = require("../memory/knowledge-base");
const vectorMemory = require("../memory/vector-memory");
const scheduler = require("../cluster/scheduler");

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

// Performance middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Request logging
app.use((req, res, next) => {
  console.log(`\n📡 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "CephasGM AI Platform",
    version: "5.0.0",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// ============================================
// AI Employee Endpoints
// ============================================

/**
 * Execute an AI employee task
 * POST /api/employee
 */
app.post("/api/employee", async (req, res) => {
  try {
    const { type, payload, options } = req.body;
    
    if (!type || !payload) {
      return res.status(400).json({ 
        error: "Missing required fields: type and payload" 
      });
    }

    console.log(`👤 Employee request: ${type}`);
    
    const result = await employees.runEmployee({ type, payload, options });
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error("Employee endpoint error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Assign task to team
 * POST /api/employee/team/:teamName
 */
app.post("/api/employee/team/:teamName", async (req, res) => {
  try {
    const { teamName } = req.params;
    const task = req.body;
    
    const result = await employees.assignToTeam(teamName, task);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all employees
 * GET /api/employees
 */
app.get("/api/employees", (req, res) => {
  try {
    const employeeList = employees.listEmployees();
    res.json({
      success: true,
      count: employeeList.length,
      employees: employeeList
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List all teams
 * GET /api/teams
 */
app.get("/api/teams", (req, res) => {
  try {
    const teams = employees.listTeams();
    res.json({
      success: true,
      count: teams.length,
      teams
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AI Gateway Endpoints
// ============================================

/**
 * AI inference request
 * POST /api/ai
 */
app.post("/api/ai", async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    console.log(`🤖 AI request: "${prompt.substring(0, 50)}..."`);
    
    const result = await gateway.request(prompt, options);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error("AI endpoint error:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Streaming AI response
 * GET /api/ai/stream?prompt=...
 */
app.get("/api/ai/stream", async (req, res) => {
  try {
    const { prompt } = req.query;
    
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = gateway.stream(prompt);
    
    for await (const chunk of stream) {
      res.write(`data: ${chunk}\n\n`);
    }
    
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List available models
 * GET /api/models
 */
app.get("/api/models", (req, res) => {
  try {
    const models = gateway.listModels?.() || ['llama3', 'mistral', 'codellama'];
    res.json({
      success: true,
      count: models.length,
      models
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Orchestrator Endpoints
// ============================================

/**
 * Submit a task to orchestrator
 * POST /api/task
 */
app.post("/api/task", async (req, res) => {
  try {
    const task = req.body;
    
    if (!task || !task.type) {
      return res.status(400).json({ error: "Task with type is required" });
    }

    const result = await orchestrator.submit(task);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Submit a workflow
 * POST /api/workflow
 */
app.post("/api/workflow", async (req, res) => {
  try {
    const workflow = req.body;
    
    if (!workflow || !workflow.tasks) {
      return res.status(400).json({ error: "Workflow with tasks is required" });
    }

    const result = await orchestrator.submitWorkflow(workflow);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get task status
 * GET /api/task/:taskId
 */
app.get("/api/task/:taskId", (req, res) => {
  try {
    const { taskId } = req.params;
    const status = orchestrator.getStatus(taskId);
    
    res.json({
      success: true,
      taskId,
      status: status || { status: 'not_found' }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get workflow status
 * GET /api/workflow/:workflowId
 */
app.get("/api/workflow/:workflowId", (req, res) => {
  try {
    const { workflowId } = req.params;
    const workflow = orchestrator.getWorkflowStatus(workflowId);
    
    res.json({
      success: true,
      workflowId,
      workflow: workflow || { status: 'not_found' }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Knowledge Base Endpoints
// ============================================

/**
 * Store knowledge
 * POST /api/knowledge
 */
app.post("/api/knowledge", (req, res) => {
  try {
    const { key, value } = req.body;
    
    if (!key || !value) {
      return res.status(400).json({ error: "Key and value are required" });
    }

    knowledgeBase.add(key, value);
    
    res.json({
      success: true,
      key,
      stored: true
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Retrieve knowledge
 * GET /api/knowledge/:key
 */
app.get("/api/knowledge/:key", (req, res) => {
  try {
    const { key } = req.params;
    const value = knowledgeBase.get(key);
    
    res.json({
      success: true,
      key,
      found: value !== undefined,
      value
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Vector Memory Endpoints
// ============================================

/**
 * Add vector to memory
 * POST /api/vector
 */
app.post("/api/vector", (req, res) => {
  try {
    const { vector, metadata } = req.body;
    
    if (!vector) {
      return res.status(400).json({ error: "Vector is required" });
    }

    vectorMemory.add(vector, metadata);
    
    res.json({
      success: true,
      stored: true,
      memorySize: vectorMemory.size()
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search vectors
 * POST /api/vector/search
 */
app.post("/api/vector/search", (req, res) => {
  try {
    const { query, limit = 10 } = req.body;
    
    const results = vectorMemory.search(query, limit);
    
    res.json({
      success: true,
      count: results.length,
      results
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Cluster Management Endpoints
// ============================================

/**
 * Get cluster status
 * GET /api/cluster
 */
app.get("/api/cluster", (req, res) => {
  try {
    const workers = scheduler.getWorkers?.() || ['node1', 'node2', 'node3'];
    const currentWorker = scheduler.nextWorker();
    
    res.json({
      success: true,
      workers,
      currentWorker,
      totalWorkers: workers.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Metrics and Monitoring
// ============================================

/**
 * Get system metrics
 * GET /api/metrics
 */
app.get("/api/metrics", (req, res) => {
  try {
    const metrics = {
      orchestrator: orchestrator.getMetrics?.(),
      employees: employees.getMetrics?.(),
      gateway: gateway.getMetrics?.(),
      memory: {
        vectorSize: vectorMemory.size?.(),
        knowledgeBaseSize: knowledgeBase.size?.()
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };
    
    res.json({
      success: true,
      ...metrics
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check for Kubernetes
 * GET /ready
 */
app.get("/ready", (req, res) => {
  res.status(200).json({ status: "ready" });
});

/**
 * Liveness probe
 * GET /live
 */
app.get("/live", (req, res) => {
  res.status(200).json({ status: "alive" });
});

// ============================================
// API Documentation
// ============================================

/**
 * API documentation
 * GET /
 */
app.get("/", (req, res) => {
  res.json({
    name: "CephasGM AI Platform API",
    version: "5.0.0",
    description: "Enterprise AI Infrastructure Platform",
    endpoints: {
      health: {
        get: "/health - System health check"
      },
      employees: {
        "POST /api/employee": "Execute AI employee task",
        "POST /api/employee/team/:teamName": "Assign task to team",
        "GET /api/employees": "List all employees",
        "GET /api/teams": "List all teams"
      },
      ai: {
        "POST /api/ai": "AI inference request",
        "GET /api/ai/stream": "Streaming AI response",
        "GET /api/models": "List available models"
      },
      tasks: {
        "POST /api/task": "Submit task to orchestrator",
        "POST /api/workflow": "Submit workflow",
        "GET /api/task/:taskId": "Get task status",
        "GET /api/workflow/:workflowId": "Get workflow status"
      },
      knowledge: {
        "POST /api/knowledge": "Store knowledge",
        "GET /api/knowledge/:key": "Retrieve knowledge"
      },
      vector: {
        "POST /api/vector": "Add vector to memory",
        "POST /api/vector/search": "Search vectors"
      },
      cluster: {
        "GET /api/cluster": "Get cluster status"
      },
      metrics: {
        "GET /api/metrics": "Get system metrics"
      }
    },
    documentation: "https://docs.cephasgm.ai",
    support: "support@cephasgm.ai"
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║   🚀 CephasGM AI Platform v5.0                                ║
║   📍 API Server running on port ${PORT}                        ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}                    ║
║   🤖 Features:                                                 ║
║      • Autonomous AI Employees                                 ║
║      • Research Pipeline                                       ║
║      • AI Coding Studio                                        ║
║      • Private AI Cloud                                        ║
║      • Distributed Workers                                     ║
║      • Knowledge Base + Vector Memory                          ║
║                                                                ║
║   📝 API Documentation: http://localhost:${PORT}                ║
║   💡 Try: curl -X POST http://localhost:${PORT}/api/ai \\       ║
║          -H "Content-Type: application/json" \\                ║
║          -d '{"prompt":"Hello"}'                               ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;
