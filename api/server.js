/**
 * API Server - CephasGM AI Platform API
 * Complete version with Audio Engine integration
 */
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs").promises;
const os = require("../core/os");
const feedbackLoop = require("../learning/feedback-loop");
const loadBalancer = require("../cluster/load-balancer");
const audioEngine = require("../multimodal/audio-engine");

// Import agents
const planner = require("../agents/planner-agent");
const research = require("../agents/research-agent");
const coding = require("../agents/coding-agent");
const automation = require("../agents/automation-agent");

// Register agents with OS
os.registerAgents([planner, research, coding, automation]);

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`\n📡 ${req.method} ${req.path}`);
  next();
});

// ============================================
// SYSTEM ENDPOINTS
// ============================================

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "CephasGM AI Platform",
    version: "4.1.0",
    timestamp: new Date().toISOString(),
    os: os.getStatus(),
    cluster: loadBalancer.getStatus(),
    audio: audioEngine.getStats()
  });
});

// System status
app.get("/status", (req, res) => {
  res.json({
    os: os.getStatus(),
    cluster: loadBalancer.getStatus(),
    learning: {
      interactions: feedbackLoop.interactions.length,
      feedback: feedbackLoop.feedback.length,
      metrics: feedbackLoop.metrics
    },
    audio: audioEngine.getStats()
  });
});

// ============================================
// TASK EXECUTION ENDPOINTS
// ============================================

// Execute task
app.post("/task", async (req, res) => {
  try {
    const { task, options = {} } = req.body;
    
    if (!task || typeof task !== 'string') {
      return res.status(400).json({ error: "Task must be a non-empty string" });
    }

    console.log(`📋 Processing task: "${task.substring(0, 100)}..."`);

    // Record interaction for learning
    const interactionId = await feedbackLoop.record(task, null, { 
      type: 'task',
      options 
    });

    // Execute through OS
    const result = await os.execute(task, options);
    
    // Update interaction with response
    if (interactionId) {
      const interaction = feedbackLoop.interactions.find(i => i.id === interactionId);
      if (interaction) {
        interaction.response = result;
      }
    }

    res.json({
      success: true,
      interactionId,
      ...result
    });

  } catch (error) {
    console.error("Task execution failed:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Execute parallel tasks
app.post("/tasks/parallel", async (req, res) => {
  try {
    const { tasks, options = {} } = req.body;
    
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: "Tasks must be an array" });
    }

    const results = await os.executeParallel(tasks, options);
    
    res.json({
      success: true,
      count: results.length,
      results
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute sequence of tasks
app.post("/tasks/sequence", async (req, res) => {
  try {
    const { tasks, options = {} } = req.body;
    
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: "Tasks must be an array" });
    }

    const results = await os.executeSequence(tasks, options);
    
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
// FEEDBACK & LEARNING ENDPOINTS
// ============================================

// Submit feedback
app.post("/feedback", async (req, res) => {
  try {
    const { interactionId, feedback, rating } = req.body;
    
    if (!interactionId || !feedback) {
      return res.status(400).json({ error: "Interaction ID and feedback are required" });
    }

    const result = await feedbackLoop.submitFeedback(interactionId, feedback, rating);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get learning insights
app.get("/insights", (req, res) => {
  try {
    const insights = feedbackLoop.getInsights();
    res.json(insights);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AGENT MANAGEMENT ENDPOINTS
// ============================================

// List agents
app.get("/agents", (req, res) => {
  try {
    const agents = os.listAgents();
    res.json({
      count: agents.length,
      agents
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent details
app.get("/agents/:name", (req, res) => {
  try {
    const agent = os.getAgent(req.params.name);
    
    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    res.json({
      name: agent.name,
      capabilities: agent.getCapabilities ? agent.getCapabilities() : [],
      metrics: agent.getMetrics ? agent.getMetrics() : {},
      status: 'active'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CLUSTER & GPU ENDPOINTS
// ============================================

// Cluster status
app.get("/cluster", (req, res) => {
  try {
    const status = loadBalancer.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute on GPU cluster
app.post("/cluster/execute", async (req, res) => {
  try {
    const { task, model = 'llama3', options = {} } = req.body;
    
    if (!task) {
      return res.status(400).json({ error: "Task is required" });
    }

    const result = await loadBalancer.execute(task, model, options);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Execute on all nodes
app.post("/cluster/execute-all", async (req, res) => {
  try {
    const { task, model = 'llama3', options = {} } = req.body;
    
    if (!task) {
      return res.status(400).json({ error: "Task is required" });
    }

    const result = await loadBalancer.executeParallel(task, model, options);
    
    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set load balancing strategy
app.post("/cluster/strategy", (req, res) => {
  try {
    const { strategy } = req.body;
    
    if (!strategy) {
      return res.status(400).json({ error: "Strategy is required" });
    }

    const result = loadBalancer.setStrategy(strategy);
    
    res.json({
      success: true,
      strategy: result
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AUDIO PROCESSING ENDPOINTS
// ============================================

/**
 * Speech-to-Text endpoint
 * POST /audio/speech-to-text
 * Body: { filePath: "/path/to/audio.mp3", options?: {} }
 */
app.post("/audio/speech-to-text", async (req, res) => {
  try {
    const { filePath, options } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }

    const result = await audioEngine.speechToText(filePath, options);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Text-to-Speech endpoint
 * POST /audio/text-to-speech
 * Body: { text: "Hello world", options?: {} }
 */
app.post("/audio/text-to-speech", async (req, res) => {
  try {
    const { text, options } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const result = await audioEngine.textToSpeech(text, options);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Stream audio file
 * GET /audio/stream/:filename
 */
app.get("/audio/stream/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(audioEngine.audioFolder, filename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: "Audio file not found" });
    }

    // Set appropriate headers
    const ext = path.extname(filename).toLowerCase();
    const contentType = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac'
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    // Stream the file
    await audioEngine.streamAudio(filePath, res);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * List audio files
 * GET /audio/files
 */
app.get("/audio/files", async (req, res) => {
  try {
    const { limit } = req.query;
    const files = await audioEngine.listFiles(parseInt(limit) || 20);
    res.json({ files, count: files.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get audio file metadata
 * GET /audio/metadata/:filename
 */
app.get("/audio/metadata/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(audioEngine.audioFolder, filename);
    
    const metadata = await audioEngine.getMetadata(filePath);
    res.json(metadata);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get audio engine stats
 * GET /audio/stats
 */
app.get("/audio/stats", (req, res) => {
  try {
    const stats = audioEngine.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete audio file
 * DELETE /audio/file/:filename
 */
app.delete("/audio/file/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(audioEngine.audioFolder, filename);
    
    const result = await audioEngine.deleteFile(filePath);
    
    if (result.success) {
      res.json({ success: true, message: "File deleted" });
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Clean up temp files
 * POST /audio/cleanup
 */
app.post("/audio/cleanup", async (req, res) => {
  try {
    const { olderThan } = req.body;
    const result = await audioEngine.cleanup(olderThan);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Convert audio format
 * POST /audio/convert
 * Body: { filePath: "/path/to/file", format: "mp3" }
 */
app.post("/audio/convert", async (req, res) => {
  try {
    const { filePath, format } = req.body;
    
    if (!filePath || !format) {
      return res.status(400).json({ error: "File path and format are required" });
    }

    const result = await audioEngine.convertAudio(filePath, format);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 CephasGM AI Platform v4.1                              ║
║   📍 API Server running on port ${PORT}                        ║
║   🤖 Agents: ${os.listAgents().length} registered                       ║
║   🖥️  Cluster: ${loadBalancer.nodes.length} GPU nodes                      ║
║   🧠 Learning: ${feedbackLoop.interactions.length} interactions logged     ║
║   🎵 Audio: STT + TTS ready                                 ║
║                                                              ║
║   📝 POST /task          - Execute AI task                  ║
║   🎤 POST /audio/text-to-speech - Generate speech           ║
║   🎧 POST /audio/speech-to-text - Transcribe audio          ║
║   📊 GET  /status        - System status                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
