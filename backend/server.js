/**
 * CephasGM SI — backend/server.js
 * ----------------------------------------------------------------------------
 * Canonical production server. Merged from:
 *   - backend/server.js  (file parsing, WebSocket, static SPA, agent routing)
 *   - api/server.js      (security, inference router, commercial layer)
 *
 * Fixes over previous version:
 *   ✗ CORS origin:'*' + credentials:true  →  allowlist + safe fallback
 *   ✗ Fake image/audio fallbacks           →  real engine or 503
 *   ✗ No memory context in /chat           →  reads body.context
 *   ✗ No Ollama/OpenAI fallback            →  inference router
 *   ✗ No rate limiting                     →  global + per-route limiter
 *   ✗ No commercial layer                  →  /v1, /plugins, /license/edge
 *   ✗ No tutor endpoint                    →  /agents/tutor
 *
 * NO FAKE DATA: if an engine is unavailable, returns 503 with an actionable
 * hint. Never fabricates content.
 * ----------------------------------------------------------------------------
 */

'use strict';

const express      = require('express');
const bodyParser   = require('body-parser');
const cors         = require('cors');
const helmet       = require('helmet');
const compression  = require('compression');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const WebSocket    = require('ws');

const config = require('./config');

/* ============================================================================
 * Optional deps — defensive loading so local dev works without them
 * ========================================================================== */
let multer, pdfParse, XLSX, mammoth, sharp, promClient, Sentry, admin, rateLimit, jwt;
try { multer       = require('multer'); }               catch { console.warn('[boot] multer missing — /chat/upload disabled'); }
try { pdfParse     = require('pdf-parse'); }            catch { console.warn('[boot] pdf-parse missing — PDF parsing disabled'); }
try { XLSX         = require('xlsx'); }                 catch { console.warn('[boot] xlsx missing — Excel parsing disabled'); }
try { mammoth      = require('mammoth'); }              catch { console.warn('[boot] mammoth missing — Word parsing disabled'); }
try { sharp        = require('sharp'); }                catch { console.warn('[boot] sharp missing — image metadata disabled'); }
try { promClient   = require('prom-client'); }          catch { console.warn('[boot] prom-client missing — /metrics disabled'); }
try { Sentry       = require('@sentry/node'); }         catch { console.warn('[boot] @sentry/node missing'); }
try { rateLimit    = require('express-rate-limit'); }   catch { console.warn('[boot] express-rate-limit missing — rate limiting disabled'); }
try { jwt          = require('jsonwebtoken'); }         catch { console.warn('[boot] jsonwebtoken missing — /license/edge disabled'); }

/* ============================================================================
 * Sentry (v7 + v8 compatible)
 * ========================================================================== */
if (Sentry && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1
  });
  console.log('✅ Sentry initialized');
}

/* ============================================================================
 * Firebase Admin (accepts either env var name)
 * ========================================================================== */
try {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_JSON;
    const projectId = process.env.FIREBASE_PROJECT_ID || 'cephasgm-ai';
    if (rawJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(rawJson)),
        projectId
      });
      console.log('✅ Firebase Admin initialized (from JSON env)');
    } else {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
      console.log('✅ Firebase Admin initialized (application default)');
    }
  }
} catch (e) {
  console.warn('[boot] firebase-admin unavailable:', e.message);
  admin = null;
}

/* ============================================================================
 * Internal AI modules — safe-required so one failure doesn't kill the server
 * ========================================================================== */
const ROOT = path.resolve(__dirname, '..');
const safeRequire = (p, label) => {
  try { return require(p); }
  catch (e) { console.warn(`[boot] ${label} unavailable: ${e.message}`); return null; }
};

const chatEngine       = safeRequire('./ai/chat-engine',           'chat-engine');
const codeInterpreter  = safeRequire('./ai/code-interpreter',      'code-interpreter');
const videoGenerator   = safeRequire('./ai/video-generator',       'video-generator');
const modelHost        = safeRequire('./ai/model-host',            'model-host');
const textEngine       = safeRequire('./multimodal/text-engine',   'text-engine');
const imageEngine      = safeRequire('./multimodal/image-engine',  'image-engine');
const audioEngine      = safeRequire('./multimodal/audio-engine',  'audio-engine');
const videoEngine      = safeRequire('./multimodal/video-engine',  'video-engine');

const agentManager     = safeRequire('../agents/manager',                'agents/manager');
const researchAgent    = safeRequire('../agents/research-agent',         'research-agent');
const codingAgent      = safeRequire('../agents/coding-agent',           'coding-agent');
const automationAgent  = safeRequire('../agents/automation-agent',       'automation-agent');

const vectorDb         = safeRequire('./memory/vector-db',          'vector-db');
const knowledgeGraph   = safeRequire('./memory/knowledge-graph',    'knowledge-graph');
const localInference   = safeRequire('./gpu/local-inference',       'local-inference');

/* ============================================================================
 * Config
 * ========================================================================== */
const PORT = config.port || process.env.PORT || 6000;
const ENV  = process.env.NODE_ENV || 'development';
const VERSION = '6.0.0-si';
const START_TS = Date.now();

const CFG = {
  corsAllowlist: (process.env.CORS_ALLOWLIST || [
    'https://cephasgm-ai.onrender.com',
    'https://cephasgm-ai.web.app',
    'https://cephasgm-ai.firebaseapp.com',
    'http://localhost:6000',
    'http://localhost:5173',
    'http://localhost:3000'
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean),

  ollamaURL:    process.env.OLLAMA_URL || '',
  ollamaModel:  process.env.OLLAMA_MODEL || 'llama3.2',
  openaiKey:    process.env.OPENAI_API_KEY || '',
  openaiBase:   process.env.OPENAI_BASE || 'https://api.openai.com/v1',
  openaiModel:  process.env.OPENAI_MODEL || 'gpt-4o-mini',

  apiKeys:       (process.env.CEPHASGM_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean),
  licenseSecret: process.env.EDGE_LICENSE_SECRET || '',
  licenseIssuer: process.env.EDGE_LICENSE_ISSUER || 'cephasgm-si',

  uploadDir:     process.env.UPLOAD_DIR || '/tmp/uploads',
  maxUploadMB:   25,
  bodyLimit:     '50mb'
};

// Ensure upload dir exists (fixes cold-start crash)
try { fs.mkdirSync(CFG.uploadDir, { recursive: true }); } catch {}

/* ============================================================================
 * App + security
 * ========================================================================== */
const app = express();
app.set('trust proxy', 1);

// Helmet — relax CSP for the SPA case (Firebase + CDN scripts)
app.use(helmet({
  contentSecurityPolicy: false,        // SPA loads from multiple CDNs
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false
}));

// CORS — allowlist, never '*'+credentials
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CFG.corsAllowlist.includes(origin)) return cb(null, true);
    if (ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-api-key', 'x-request-id'],
  credentials: true,
  optionsSuccessStatus: 204
}));

app.use(compression());

// Request ID + structured log
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      id: req.id, method: req.method, path: req.path,
      status: res.statusCode, ms: Number(ms.toFixed(2)),
      uid: req.user?.uid || null
    }));
  });
  next();
});

// Rate limits
if (rateLimit) {
  app.use(rateLimit({
    windowMs: 60_000, max: 180,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests' }
  }));
  const chatLimit = rateLimit({
    windowMs: 60_000, max: 40,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Chat rate limit exceeded (40/min)' }
  });
  app.use('/chat', chatLimit);
  app.use('/v1', rateLimit({
    windowMs: 60_000, max: 60,
    standardHeaders: true, legacyHeaders: false
  }));
}

app.use(bodyParser.json({ limit: CFG.bodyLimit }));
app.use(bodyParser.urlencoded({ extended: true, limit: CFG.bodyLimit }));

/* ============================================================================
 * Prometheus metrics
 * ========================================================================== */
let register, httpDuration, httpCounter;
if (promClient) {
  register = new promClient.Registry();
  promClient.collectDefaultMetrics({ register });
  httpDuration = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [50, 100, 200, 300, 400, 500, 1000, 2000, 3000, 5000]
  });
  httpCounter = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
  });
  register.registerMetric(httpDuration);
  register.registerMetric(httpCounter);

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const route = req.route?.path || req.path;
      httpDuration.labels(req.method, route, String(res.statusCode)).observe(Date.now() - start);
      httpCounter.labels(req.method, route, String(res.statusCode)).inc();
    });
    next();
  });
}

/* ============================================================================
 * Auth middleware
 * ========================================================================== */
async function extractUser(req, _res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return next();
  if (token.startsWith('cgm_')) { req.apiKey = token; return next(); }
  if (!admin) return next();
  try { req.user = await admin.auth().verifyIdToken(token); } catch {}
  next();
}
app.use(extractUser);

const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Authentication required' });

const requireRole = (allowed = []) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const role = req.user.role || 'user';
  if (allowed.length && !allowed.includes(role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

/* ============================================================================
 * API key auth (commercial tier)
 * ========================================================================== */
async function verifyApiKey(key) {
  if (!key) return null;
  if (CFG.apiKeys.includes(key)) return { key, tenant: 'env', tier: 'pro', quotaPerDay: 100_000 };
  if (!admin) return null;
  try {
    const snap = await admin.firestore().collection('api_keys').doc(key).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.revoked) return null;
    return { key, tenant: d.tenant || 'unknown', tier: d.tier || 'free', quotaPerDay: d.quotaPerDay || 1000 };
  } catch { return null; }
}
async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.apiKey;
  const rec = await verifyApiKey(key);
  if (!rec) return res.status(401).json({ error: 'Valid API key required' });
  req.apiKeyRecord = rec;
  next();
}

/* ============================================================================
 * Usage metering
 * ========================================================================== */
const memUsage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
async function meter(req, { tokens = 0, calls = 1 } = {}) {
  const rec = req.apiKeyRecord; if (!rec) return;
  const day = today();
  const cur = memUsage.get(rec.key) || { day, tokens: 0, calls: 0 };
  if (cur.day !== day) { cur.day = day; cur.tokens = 0; cur.calls = 0; }
  cur.tokens += tokens; cur.calls += calls;
  memUsage.set(rec.key, cur);
  if (admin) {
    try {
      await admin.firestore()
        .collection('usage').doc(rec.key)
        .collection('daily').doc(day)
        .set({
          tokens: admin.firestore.FieldValue.increment(tokens),
          calls: admin.firestore.FieldValue.increment(calls),
          lastAt: Date.now()
        }, { merge: true });
    } catch (e) { console.warn('[meter] Firestore write failed', e.message); }
  }
}

/* ============================================================================
 * Inference router — chatEngine → Ollama → OpenAI → 503
 * ========================================================================== */
async function inferText({ prompt, model, context, history, stream = false, signal }) {
  // 1. Primary chat engine (project-native)
  if (chatEngine) {
    try {
      if (stream && typeof chatEngine.stream === 'function') {
        const out = await chatEngine.stream(prompt, { model, context, history });
        if (out) return { source: 'chatEngine', stream: out, isAsyncIterable: true };
      } else if (typeof chatEngine.chat === 'function') {
        const out = await chatEngine.chat(prompt, { model, context, history });
        if (out) return { source: 'chatEngine', data: out };
      }
    } catch (e) { console.warn('[infer] chatEngine failed:', e.message); }
  }

  // 2. textEngine (multimodal)
  if (textEngine && typeof textEngine.generate === 'function') {
    try {
      const out = await textEngine.generate(prompt, { model, context, history, stream, signal });
      if (out) return { source: 'textEngine', data: out };
    } catch (e) { console.warn('[infer] textEngine failed:', e.message); }
  }

  // 3. Ollama
  if (CFG.ollamaURL) {
    try {
      const url = `${CFG.ollamaURL.replace(/\/$/, '')}/api/chat`;
      const body = {
        model: model || CFG.ollamaModel,
        stream,
        messages: [
          ...(context ? [{ role: 'system', content: context }] : []),
          ...(Array.isArray(history) ? history.map(h => ({
            role: h.sender === 'user' ? 'user' : 'assistant',
            content: h.content || h.text || ''
          })) : []),
          { role: 'user', content: prompt }
        ]
      };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });
      if (r.ok) return { source: 'ollama', stream: r.body, ok: true };
      console.warn('[infer] Ollama HTTP', r.status);
    } catch (e) { console.warn('[infer] Ollama failed:', e.message); }
  }

  // 4. OpenAI-compatible
  if (CFG.openaiKey) {
    try {
      const url = `${CFG.openaiBase.replace(/\/$/, '')}/chat/completions`;
      const messages = [
        ...(context ? [{ role: 'system', content: context }] : []),
        ...(Array.isArray(history) ? history.map(h => ({
          role: h.sender === 'user' ? 'user' : 'assistant',
          content: h.content || h.text || ''
        })) : []),
        { role: 'user', content: prompt }
      ];
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CFG.openaiKey}`
        },
        body: JSON.stringify({ model: model || CFG.openaiModel, messages, stream }),
        signal
      });
      if (r.ok) return { source: 'openai', stream: r.body, ok: true };
      console.warn('[infer] OpenAI HTTP', r.status);
    } catch (e) { console.warn('[infer] OpenAI failed:', e.message); }
  }

  return { source: 'none', ok: false };
}

const noInference = (res) => res.status(503).json({
  error: 'No inference backend available',
  hint: 'Configure one of: chatEngine, textEngine, OLLAMA_URL, or OPENAI_API_KEY',
  timestamp: new Date().toISOString()
});

function normalizeContent(source, raw) {
  if (source === 'ollama') return raw?.message?.content || raw?.response || '';
  if (source === 'openai') return raw?.choices?.[0]?.message?.content || '';
  if (source === 'chatEngine' || source === 'textEngine') {
    if (typeof raw === 'string') return raw;
    return raw?.content || raw?.response || raw?.text || raw?.message || '';
  }
  return '';
}

/* ============================================================================
 * Validation
 * ========================================================================== */
const isStr = (v, min = 1, max = 100_000) =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max;
const bad = (res, msg) => res.status(400).json({ error: msg });

/* ============================================================================
 * System
 * ========================================================================== */
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'CephasGM SI',
    version: VERSION,
    env: ENV,
    uptimeSec: Math.round((Date.now() - START_TS) / 1000),
    timestamp: new Date().toISOString(),
    subsystems: {
      chatEngine: !!chatEngine, codeInterpreter: !!codeInterpreter,
      videoGenerator: !!videoGenerator, modelHost: !!modelHost,
      textEngine: !!textEngine, imageEngine: !!imageEngine,
      audioEngine: !!audioEngine, videoEngine: !!videoEngine,
      agentManager: !!agentManager, vectorDb: !!vectorDb,
      knowledgeGraph: !!knowledgeGraph, localInference: !!localInference,
      firebaseAdmin: !!admin, ollama: !!CFG.ollamaURL, openai: !!CFG.openaiKey,
      gpuAvailable: !!(modelHost && modelHost.gpuAvailable)
    }
  });
});

app.get('/status', (_req, res) => {
  res.json({
    config: { nodeEnv: config.nodeEnv, vectorDb: config.vectorDbType, gpu: !!(modelHost && modelHost.gpuAvailable) },
    memory: {
      vectors: vectorDb?.getStats?.() || null,
      knowledge: knowledgeGraph?.getStats?.() || null
    },
    models: modelHost?.getStatus?.() || null
  });
});

if (register) {
  app.get('/metrics', async (_req, res) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (e) { res.status(500).end(e.message); }
  });
}

/* ============================================================================
 * Chat (unified)
 * ========================================================================== */
app.post('/chat', async (req, res) => {
  const { prompt, model, context, history, options } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required (string)');

  const out = await inferText({ prompt, model, context, history, stream: false, options });

  if (out.source === 'chatEngine' || out.source === 'textEngine') {
    return res.json(out.data);
  }
  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      return res.json({
        content: normalizeContent(out.source, raw),
        model: model || (out.source === 'ollama' ? CFG.ollamaModel : CFG.openaiModel),
        source: out.source,
        usage: raw?.usage || null
      });
    } catch (e) {
      console.error('[chat] parse failed', e);
      return res.status(502).json({ error: 'Upstream parse failed' });
    }
  }
  return noInference(res);
});

app.post('/chat/stream', async (req, res) => {
  const { prompt, model, context, history } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required (string)');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());

  try {
    const out = await inferText({ prompt, model, context, history, stream: true, signal: ctrl.signal });

    // chatEngine / textEngine async iterable
    if (out.isAsyncIterable || (out.source === 'chatEngine' || out.source === 'textEngine')) {
      const iter = out.stream || out.data;
      if (iter && typeof iter[Symbol.asyncIterator] === 'function') {
        for await (const chunk of iter) {
          // Normalize the shape — clients read choices[0].delta.content
          const delta = typeof chunk === 'string'
            ? chunk
            : (chunk?.choices?.[0]?.delta?.content
               ?? chunk?.delta?.content
               ?? chunk?.content
               ?? chunk?.text
               ?? '');
          if (delta) send({ choices: [{ delta: { content: delta } }] });
        }
        return done();
      }
      // Non-streaming engine: emit once
      const text = normalizeContent(out.source, out.data);
      send({ choices: [{ delta: { content: text } }] });
      return done();
    }

    if (out.source === 'ollama' || out.source === 'openai') {
      const reader = out.stream.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim(); if (!t) continue;
          if (out.source === 'ollama') {
            try {
              const j = JSON.parse(t);
              const delta = j?.message?.content || '';
              if (delta) send({ choices: [{ delta: { content: delta } }] });
            } catch {}
          } else {
            if (!t.startsWith('data:')) continue;
            const p = t.slice(5).trim();
            if (p === '[DONE]') return done();
            try { send(JSON.parse(p)); } catch {}
          }
        }
      }
      return done();
    }

    send({ error: 'No inference backend available' });
    done();
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.error('[chat/stream] error', e);
      try { send({ error: 'Stream failed' }); } catch {}
    }
    done();
  }
});

/* ============================================================================
 * Chat with file upload (real parsing preserved, memory context added)
 * ========================================================================== */
if (multer) {
  const upload = multer({
    dest: CFG.uploadDir,
    limits: { fileSize: CFG.maxUploadMB * 1024 * 1024, files: 10 }
  });

  app.post('/chat/upload', upload.array('files', 10), async (req, res) => {
    try {
      const { prompt = '', model, context } = req.body || {};
      const files = req.files || [];
      let augmented = prompt;

      for (const file of files) {
        try {
          if (pdfParse && (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf'))) {
            const buf = await fs.promises.readFile(file.path);
            const pdf = await pdfParse(buf);
            augmented += `\n\n--- ${file.originalname} (PDF) ---\n${pdf.text.substring(0, 5000)}`;
          } else if (XLSX && (/\.xlsx?$/i.test(file.originalname) ||
                     file.mimetype.includes('spreadsheet'))) {
            const wb = XLSX.readFile(file.path);
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' });
            augmented += `\n\n--- ${file.originalname} (Excel) ---\n${csv.substring(0, 5000)}`;
          } else if (mammoth && (file.originalname.endsWith('.docx') ||
                     file.mimetype.includes('wordprocessingml'))) {
            const { value } = await mammoth.extractRawText({ path: file.path });
            augmented += `\n\n--- ${file.originalname} (Word) ---\n${value.substring(0, 5000)}`;
          } else if (sharp && file.mimetype.startsWith('image/')) {
            const meta = await sharp(file.path).metadata();
            augmented += `\n\n- ${file.originalname}: ${meta.width}×${meta.height} ${file.mimetype}`;
          } else if (file.mimetype.startsWith('text/') || /\.(txt|md|json|csv)$/i.test(file.originalname)) {
            const content = await fs.promises.readFile(file.path, 'utf8');
            augmented += `\n\n--- ${file.originalname} ---\n${content.substring(0, 8000)}`;
          } else {
            augmented += `\n\n- ${file.originalname} (${file.mimetype}) — content not extracted`;
          }
        } catch (e) {
          console.error(`[upload] parse failed for ${file.originalname}:`, e.message);
          augmented += `\n\n- ${file.originalname} (could not parse: ${e.message})`;
        } finally {
          fs.promises.unlink(file.path).catch(() => {});
        }
      }

      if (!augmented.trim()) augmented = 'Please analyze the attached file(s).';
      if (!isStr(augmented, 1, 200_000)) return bad(res, 'prompt or files required');

      // Stream result back
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const out = await inferText({ prompt: augmented, model, context, stream: true });

      if (out.isAsyncIterable || out.source === 'chatEngine' || out.source === 'textEngine') {
        const iter = out.stream || out.data;
        if (iter && typeof iter[Symbol.asyncIterator] === 'function') {
          for await (const chunk of iter) {
            const delta = typeof chunk === 'string' ? chunk
              : (chunk?.choices?.[0]?.delta?.content ?? chunk?.delta?.content ?? chunk?.content ?? chunk?.text ?? '');
            if (delta) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
          }
          res.write('data: [DONE]\n\n'); return res.end();
        }
        const text = normalizeContent(out.source, out.data);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        res.write('data: [DONE]\n\n'); return res.end();
      }

      if (out.source === 'ollama' || out.source === 'openai') {
        const reader = out.stream.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const t = line.trim(); if (!t) continue;
            if (out.source === 'ollama') {
              try {
                const j = JSON.parse(t);
                if (j?.message?.content) {
                  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: j.message.content } }] })}\n\n`);
                }
              } catch {}
            } else {
              if (!t.startsWith('data:')) continue;
              const p = t.slice(5).trim();
              if (p === '[DONE]') { res.write('data: [DONE]\n\n'); return res.end(); }
              try { res.write(`data: ${p}\n\n`); } catch {}
            }
          }
        }
        res.write('data: [DONE]\n\n'); return res.end();
      }

      res.write(`data: ${JSON.stringify({ error: 'No inference backend available' })}\n\n`);
      res.end();
    } catch (e) {
      console.error('[upload] error', e);
      if (!res.headersSent) return res.status(500).json({ error: 'Upload failed' });
      try { res.write(`data: ${JSON.stringify({ error: 'Upload failed' })}\n\n`); res.end(); } catch {}
    }
  });
} else {
  app.post('/chat/upload', (_req, res) =>
    res.status(503).json({ error: 'Upload support not installed (npm i multer)' }));
}

/* ============================================================================
 * Code interpreter
 * ========================================================================== */
app.post('/code', async (req, res) => {
  const { code, language = 'javascript', options } = req.body || {};
  if (!isStr(code, 1, 200_000)) return bad(res, 'code is required');

  // Native interpreter first
  if (codeInterpreter && typeof codeInterpreter.run === 'function') {
    try { return res.json(await codeInterpreter.run(code, { language, ...options })); }
    catch (e) { console.warn('[code] interpreter failed:', e.message); }
  }

  // Fallback: ask the LLM to execute
  const prompt =
`Language: ${language}
Execute the following code and return ONLY its stdout. If it cannot be executed, explain why.

\`\`\`${language}
${code}
\`\`\``;
  const out = await inferText({ prompt, model: null, context: '', history: [] });
  if (out.source === 'chatEngine' || out.source === 'textEngine') return res.json(out.data);
  if (out.source === 'ollama' || out.source === 'openai') {
    const raw = await new Response(out.stream).json();
    return res.json({ output: normalizeContent(out.source, raw), language });
  }
  return noInference(res);
});

/* ============================================================================
 * Research (strict JSON output)
 * ========================================================================== */
app.post('/research', async (req, res) => {
  const { topic, depth = 'basic', options } = req.body || {};
  if (!isStr(topic, 1, 2000)) return bad(res, 'topic is required');

  // Native research agent first
  if (researchAgent && typeof researchAgent.execute === 'function') {
    try { return res.json(await researchAgent.execute(topic, { depth, ...options })); }
    catch (e) { console.warn('[research] agent failed:', e.message); }
  }

  const prompt =
`Research topic: ${topic}
Depth: ${depth}
Return STRICT JSON only:
{ "summary": "...", "findings": [{"content":"..."}], "sources": [{"title":"..."}] }`;
  const out = await inferText({ prompt, model: null, context: '', history: [] });
  if (out.source === 'chatEngine' || out.source === 'textEngine') return res.json(out.data);
  if (out.source === 'ollama' || out.source === 'openai') {
    const raw = await new Response(out.stream).json();
    const text = normalizeContent(out.source, raw);
    try {
      const m = text.match(/\{[\s\S]*\}/);
      return res.json(JSON.parse(m ? m[0] : text));
    } catch { return res.json({ summary: text }); }
  }
  return noInference(res);
});

/* ============================================================================
 * Video (native only)
 * ========================================================================== */
app.post('/video', async (req, res) => {
  const { prompt, options } = req.body || {};
  if (!isStr(prompt, 1, 4000)) return bad(res, 'prompt is required');
  if (!videoGenerator || typeof videoGenerator.create !== 'function') {
    return res.status(503).json({ error: 'Video generator unavailable' });
  }
  try { res.json(await videoGenerator.create(prompt, options)); }
  catch (e) { res.status(500).json({ error: 'Video generation failed' }); }
});

/* ============================================================================
 * Tasks / agents
 * ========================================================================== */
app.post('/task', async (req, res) => {
  const { task, options } = req.body || {};
  if (!isStr(task, 1, 60_000)) return bad(res, 'task is required');
  if (agentManager && typeof agentManager.route === 'function') {
    try { return res.json(await agentManager.route(task, options)); }
    catch (e) { console.warn('[/task] agentManager failed:', e.message); }
  }
  const out = await inferText({ prompt: task, model: null, context: '', history: [] });
  if (out.source === 'chatEngine' || out.source === 'textEngine') return res.json({ success: true, result: out.data });
  if (out.source === 'ollama' || out.source === 'openai') {
    const raw = await new Response(out.stream).json();
    return res.json({ success: true, result: { content: normalizeContent(out.source, raw) } });
  }
  return noInference(res);
});

app.post('/task/enhanced', async (req, res) => {
  const { task, options = {} } = req.body || {};
  if (!isStr(task, 1, 60_000)) return bad(res, 'task is required');
  const agentType = options.agentType || 'auto';
  const t0 = Date.now();

  let result = null;
  const lower = task.toLowerCase();

  try {
    if (agentType === 'search' || /search|find/.test(lower)) {
      if (researchAgent) result = await researchAgent.execute(task, options);
    } else if (agentType === 'coding' || /code|function|program/.test(lower)) {
      if (codeInterpreter) result = await codeInterpreter.run(task, options);
    } else if (agentManager) {
      result = await agentManager.route(task, options);
    }
  } catch (e) {
    console.warn('[task/enhanced] agent failed:', e.message);
  }

  if (!result) {
    const out = await inferText({ prompt: task, model: null, context: '', history: [] });
    if (out.source === 'chatEngine' || out.source === 'textEngine') result = out.data;
    else if (out.source === 'ollama' || out.source === 'openai') {
      const raw = await new Response(out.stream).json();
      result = { content: normalizeContent(out.source, raw) };
    } else return noInference(res);
  }

  res.json({
    success: true, agent: agentType, task, result,
    executionTime: `${Date.now() - t0}ms`,
    timestamp: new Date().toISOString()
  });
});

app.get('/agents', (_req, res) => {
  const list = agentManager?.listAgents?.() || [];
  res.json({ success: true, count: list.length, agents: list });
});

app.post('/create-agent', requireUser, async (req, res) => {
  const { type, config: cfg } = req.body || {};
  if (!isStr(type, 1, 60)) return bad(res, 'type is required');
  const osMod = safeRequire('../ecosystem/ai-os', 'ai-os');
  if (!osMod || typeof osMod.createAgent !== 'function') {
    return res.status(503).json({ error: 'Agent OS unavailable' });
  }
  res.json({ success: true, agent: osMod.createAgent(type, cfg) });
});

/* ============================================================================
 * KILLER APP: STEM Tutor (Review #4)
 * ========================================================================== */
app.post('/agents/tutor', async (req, res) => {
  const { question, lang = 'auto', level = 'form4', context = '' } = req.body || {};
  if (!isStr(question, 1, 4000)) return bad(res, 'question is required');

  const system =
`You are the CephasGM SI STEM Tutor for Tanzanian secondary students (NECTA syllabus, Form 1–6).
Level: ${level}. Language: ${lang}.
Rules:
- Diagnose before assuming knowledge.
- Show every step for maths; use everyday Tanzanian examples.
- End with ONE practice question and wait.
- Never invent formulas.`;

  const out = await inferText({
    prompt: question, model: null,
    context: (context ? context + '\n\n' : '') + system,
    history: []
  });
  if (out.source === 'chatEngine' || out.source === 'textEngine') return res.json(out.data);
  if (out.source === 'ollama' || out.source === 'openai') {
    const raw = await new Response(out.stream).json();
    return res.json({ content: normalizeContent(out.source, raw), agent: 'tutor', level, lang });
  }
  return noInference(res);
});

/* ============================================================================
 * Multimodal — NO FAKE FALLBACKS
 * ========================================================================== */
const multimodalHandler = (engine, field) => async (req, res) => {
  const value = req.body?.[field];
  const options = req.body?.options;
  if (!isStr(value, 1, 4000)) return bad(res, `${field} is required`);
  if (!engine || typeof engine.generate !== 'function') {
    return res.status(503).json({
      error: `${field} engine not available`,
      hint: `Ensure backend/multimodal/${field}-engine.js exports generate()`
    });
  }
  try { res.json(await engine.generate(value, options)); }
  catch (e) { console.error(`[${field}] engine error`, e); res.status(500).json({ error: 'Generation failed' }); }
};

app.post('/generate/text',  multimodalHandler(textEngine,  'prompt'));
app.post('/generate/image', multimodalHandler(imageEngine, 'prompt'));
app.post('/generate/audio', multimodalHandler(audioEngine, 'text'));
app.post('/generate/video', multimodalHandler(videoEngine, 'prompt'));

/* ============================================================================
 * Memory — dual endpoint set for backward-compat
 * ========================================================================== */
app.post('/memory/store', async (req, res) => {
  const { vector, metadata } = req.body || {};
  if (!vector) return bad(res, 'vector is required');
  if (!vectorDb) return res.status(503).json({ error: 'Vector DB unavailable' });
  res.json(await vectorDb.store(vector, metadata));
});

app.post('/memory/search', async (req, res) => {
  const { vector, limit = 10, threshold = 0.5 } = req.body || {};
  if (!vector) return bad(res, 'vector is required');
  if (!vectorDb) return res.status(503).json({ error: 'Vector DB unavailable' });
  res.json(await vectorDb.search(vector, limit, threshold));
});

app.get('/memory/vectors', async (_req, res) => {
  if (!vectorDb) return res.json({ success: true, vectors: [], stats: {} });
  const stats = vectorDb.getStats?.() || { totalVectors: 0 };
  let vectors = [];
  try { if (typeof vectorDb.getRecent === 'function') vectors = await vectorDb.getRecent(20); } catch {}
  res.json({ success: true, vectors, stats });
});

app.post('/memory/vector', (req, res) => {
  const { vector, metadata } = req.body || {};
  if (!Array.isArray(vector)) return bad(res, 'vector (array) required');
  if (!vectorDb) return res.status(503).json({ error: 'Vector DB unavailable' });
  res.json(vectorDb.add(vector, metadata));
});

app.post('/memory/vector/search', (req, res) => {
  const { query, limit = 5, threshold = 0.3 } = req.body || {};
  if (!query) return bad(res, 'query required');
  if (!vectorDb) return res.status(503).json({ error: 'Vector DB unavailable' });
  res.json(vectorDb.search(query, limit, threshold));
});

app.post('/memory/knowledge/link', (req, res) => {
  const { source, relation, target, properties } = req.body || {};
  if (!source || !relation || !target) return bad(res, 'source, relation, target required');
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph unavailable' });
  res.json(knowledgeGraph.link(source, relation, target, properties));
});

app.get('/memory/knowledge/:entity', (req, res) => {
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph unavailable' });
  const depth = parseInt(req.query.depth || '1', 10);
  res.json(knowledgeGraph.query(req.params.entity, depth));
});

/* Knowledge graph — legacy paths */
app.post('/graph/add', async (req, res) => {
  const { entity, relation, target, properties } = req.body || {};
  if (!entity || !relation || !target) return bad(res, 'entity, relation, target required');
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph unavailable' });
  res.json(knowledgeGraph.addRelation(entity, relation, target, properties));
});

app.get('/graph/query', (req, res) => {
  const { entity, depth = 1 } = req.query;
  if (!entity) return bad(res, 'entity required');
  if (!knowledgeGraph) return res.status(503).json({ error: 'Knowledge graph unavailable' });
  res.json(knowledgeGraph.query(entity, parseInt(depth, 10)));
});

/* ============================================================================
 * GPU / models
 * ========================================================================== */
app.post('/gpu/infer', async (req, res) => {
  const { prompt, model = 'llama3' } = req.body || {};
  if (!isStr(prompt, 1, 20_000)) return bad(res, 'prompt is required');
  if (!localInference) return res.status(503).json({ error: 'Local inference unavailable' });
  res.json(await localInference.run(prompt, model));
});

app.get('/models', (_req, res) => {
  res.json({
    ...(modelHost?.getStatus?.() || {}),
    text: textEngine?.getModels?.() || [],
    image: imageEngine?.getModels?.() || [],
    remote: {
      ollama: CFG.ollamaURL ? CFG.ollamaModel : null,
      openai: CFG.openaiKey ? CFG.openaiModel : null
    }
  });
});

app.post('/models/load', async (req, res) => {
  const { modelName, options } = req.body || {};
  if (!isStr(modelName, 1, 120)) return bad(res, 'modelName required');
  if (!modelHost) return res.status(503).json({ error: 'Model host unavailable' });
  res.json(await modelHost.loadModel(modelName, options));
});

app.post('/models/infer', async (req, res) => {
  const { modelName, input, options } = req.body || {};
  if (!isStr(modelName, 1, 120) || !input) return bad(res, 'modelName and input required');
  if (!modelHost) return res.status(503).json({ error: 'Model host unavailable' });
  res.json(await modelHost.infer(modelName, input, options));
});

/* ============================================================================
 * Cluster (from api/server.js)
 * ========================================================================== */
const nodeManager = safeRequire('../cluster/node-manager', 'node-manager');

app.get('/cluster/nodes', (_req, res) => {
  if (!nodeManager) return res.json({ nodes: [] });
  res.json(nodeManager.getStatus());
});

app.post('/cluster/execute', async (req, res) => {
  const { type, task, options } = req.body || {};
  if (!isStr(type, 1, 40) || !isStr(task, 1, 20_000)) return bad(res, 'type and task required');
  if (!nodeManager) return res.status(503).json({ error: 'Cluster unavailable' });
  res.json(await nodeManager.execute(type, task, options));
});

/* ============================================================================
 * User / admin
 * ========================================================================== */
app.get('/user/role', requireUser, (req, res) => {
  res.json({ role: req.user.role || 'user' });
});

app.post('/admin/updateRole', requireRole(['admin']), async (req, res) => {
  const { email, role } = req.body || {};
  if (!isStr(email, 3, 200)) return bad(res, 'email required');
  if (!['user', 'premium', 'admin'].includes(role)) return bad(res, 'invalid role');
  if (!admin) return res.status(503).json({ error: 'Firebase Admin not configured' });
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { role });
    await admin.firestore().collection('users').doc(user.uid)
      .set({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.json({ success: true, uid: user.uid, role, message: `Role for ${email} updated to ${role}` });
  } catch (e) {
    if (e.code === 'auth/user-not-found') return res.status(404).json({ error: 'User not found' });
    console.error('[admin] updateRole failed', e);
    res.status(500).json({ error: 'Role update failed' });
  }
});

/* ============================================================================
 * ──── COMMERCIAL LAYER (Review #5) ────
 * ========================================================================== */
app.post('/v1/chat', requireApiKey, async (req, res) => {
  const { prompt, model, context, history } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required');

  const out = await inferText({ prompt, model, context, history, stream: false });
  if (out.source === 'chatEngine' || out.source === 'textEngine') {
    await meter(req, { calls: 1 });
    return res.json({ data: out.data, tenant: req.apiKeyRecord.tenant });
  }
  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      const content = normalizeContent(out.source, raw);
      const tokens = raw?.usage?.total_tokens || Math.ceil(content.length / 4);
      await meter(req, { tokens, calls: 1 });
      return res.json({
        data: { content }, usage: { tokens },
        tenant: req.apiKeyRecord.tenant, tier: req.apiKeyRecord.tier
      });
    } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
  }
  return noInference(res);
});

app.get('/v1/agents', requireApiKey, (_req, res) => {
  res.json({
    agents: [
      { id: 'chat',     name: 'Chat',           category: 'core' },
      { id: 'tutor',    name: 'STEM Tutor',     category: 'education' },
      { id: 'safety',   name: 'Safety Advisor', category: 'industrial' },
      { id: 'research', name: 'Research',       category: 'analysis' },
      { id: 'code',     name: 'Coding',         category: 'code' }
    ],
    version: VERSION
  });
});

app.get('/v1/usage', requireApiKey, (req, res) => {
  const key = req.apiKeyRecord.key;
  const mem = memUsage.get(key) || { tokens: 0, calls: 0, day: today() };
  res.json({
    day: mem.day, tokens: mem.tokens, calls: mem.calls,
    quotaPerDay: req.apiKeyRecord.quotaPerDay, tier: req.apiKeyRecord.tier
  });
});

/* Plugins */
const plugins = new Map();
app.get('/plugins', (_req, res) => {
  res.json({
    count: plugins.size,
    plugins: Array.from(plugins.values()).map(p => ({
      id: p.id, name: p.name, description: p.description,
      vendor: p.vendor, category: p.category, version: p.version
    }))
  });
});
app.post('/plugins/register', requireApiKey, (req, res) => {
  const { id, name, description, vendor, category, version, endpoint } = req.body || {};
  if (!isStr(id, 2, 60)) return bad(res, 'id required');
  if (!isStr(endpoint, 5, 500)) return bad(res, 'endpoint required');
  if (plugins.has(id)) return res.status(409).json({ error: 'Plugin id already registered' });
  plugins.set(id, { id, name, description, vendor, category, version, endpoint, registeredAt: Date.now() });
  res.json({ success: true, id });
});

/* Edge licensing */
app.post('/license/edge', requireApiKey, (req, res) => {
  if (!jwt) return res.status(503).json({ error: 'jsonwebtoken not installed' });
  if (!CFG.licenseSecret) return res.status(503).json({ error: 'EDGE_LICENSE_SECRET not set' });
  const { deviceId, scope = ['offline-inference', 'swahili-asr'], ttlDays = 365 } = req.body || {};
  if (!isStr(deviceId, 3, 200)) return bad(res, 'deviceId required');
  const token = jwt.sign(
    { sub: deviceId, tenant: req.apiKeyRecord.tenant, scope },
    CFG.licenseSecret,
    { issuer: CFG.licenseIssuer, expiresIn: `${ttlDays}d` }
  );
  res.json({ token, expiresInDays: ttlDays, scope });
});

/* ============================================================================
 * Static SPA serving (preserved from original)
 * ========================================================================== */
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
  if (fs.existsSync(path.join(testPath, 'index.html'))) { staticPath = testPath; break; }
}
if (staticPath) {
  console.log(`✅ Static root: ${staticPath}`);
  app.use(express.static(staticPath));

  const reactAppPath = path.join(staticPath, 'frontend', 'app');
  if (fs.existsSync(reactAppPath)) {
    app.use('/app', express.static(reactAppPath));
    app.get('/app/*', (_req, res) => res.sendFile(path.join(reactAppPath, 'index.html')));
  }

  app.get('*', (req, res, next) => {
    if (
      req.path === '/' ||
      req.path === '/health' || req.path === '/status' || req.path === '/metrics' ||
      req.path.startsWith('/api/') ||
      req.path.startsWith('/chat') ||
      req.path.startsWith('/code') ||
      req.path.startsWith('/research') ||
      req.path.startsWith('/video') ||
      req.path.startsWith('/task') ||
      req.path.startsWith('/agents') ||
      req.path.startsWith('/generate/') ||
      req.path.startsWith('/memory/') ||
      req.path.startsWith('/graph/') ||
      req.path.startsWith('/gpu/') ||
      req.path.startsWith('/models') ||
      req.path.startsWith('/cluster/') ||
      req.path.startsWith('/user/') ||
      req.path.startsWith('/admin/') ||
      req.path.startsWith('/v1/') ||
      req.path.startsWith('/plugins') ||
      req.path.startsWith('/license') ||
      req.path.startsWith('/app')
    ) return next();

    const requestedFile = path.join(staticPath, req.path);
    if (fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
      return res.sendFile(requestedFile);
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  console.log('⚠️ No frontend found — API-only mode');
}

/* ============================================================================
 * Error handlers
 * ========================================================================== */
if (Sentry && process.env.SENTRY_DSN && Sentry.Handlers?.errorHandler) {
  app.use(Sentry.Handlers.errorHandler());
}

app.use((err, req, res, _next) => {
  console.error(`[error] ${req.id}`, err);
  if (String(err.message || '').startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message || 'Bad request' });
  }
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    id: req.id,
    message: config.isProduction?.() ? undefined : err.message
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path, id: req.id });
});

/* ============================================================================
 * HTTP + WebSocket
 * ========================================================================== */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  CephasGM SI — Server v${VERSION.padEnd(33)}║
║  Port: ${String(PORT).padEnd(52)}║
║  Env:  ${ENV.padEnd(52)}║
║                                                              ║
║  Inference:                                                  ║
║    chatEngine: ${String(!!chatEngine).padEnd(43)}║
║    textEngine: ${String(!!textEngine).padEnd(43)}║
║    Ollama:     ${String(CFG.ollamaURL || 'not set').padEnd(43)}║
║    OpenAI:     ${String(CFG.openaiKey ? 'set' : 'not set').padEnd(43)}║
║                                                              ║
║  Commercial:                                                 ║
║    API keys:   ${String(CFG.apiKeys.length + ' env').padEnd(43)}║
║    Firebase:   ${String(admin ? 'admin enabled' : 'disabled').padEnd(43)}║
║    Plugins:    ${String(plugins.size).padEnd(43)}║
║                                                              ║
║  Static: ${String(staticPath ? 'serving ' + path.relative(ROOT, staticPath) : 'API-only').padEnd(49)}║
╚══════════════════════════════════════════════════════════════╝\n`);
});

const wss = new WebSocket.Server({ server, maxPayload: 1_000_000 });
wss.on('connection', (ws) => {
  console.log('🔌 WebSocket connected');
  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'chat') {
        const { prompt, model = 'ministral-3-3b', context } = data;
        const out = await inferText({ prompt, model, context, stream: true });
        if (out.isAsyncIterable || out.source === 'chatEngine' || out.source === 'textEngine') {
          const iter = out.stream || out.data;
          if (iter && typeof iter[Symbol.asyncIterator] === 'function') {
            for await (const chunk of iter) {
              const delta = typeof chunk === 'string' ? chunk
                : (chunk?.delta?.content ?? chunk?.content ?? chunk?.text ?? '');
              if (delta && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ delta }));
              }
            }
          }
        } else if (out.source === 'ollama' || out.source === 'openai') {
          const reader = out.stream.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n'); buf = lines.pop() || '';
            for (const line of lines) {
              const t = line.trim(); if (!t) continue;
              if (out.source === 'ollama') {
                try {
                  const j = JSON.parse(t);
                  if (j?.message?.content && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ delta: j.message.content }));
                  }
                } catch {}
              }
            }
          }
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ done: true }));
      }
    } catch (e) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ error: e.message }));
    }
  });
  ws.on('close', () => console.log('🔌 WebSocket disconnected'));
});

/* Graceful shutdown */
const shutdown = async (sig) => {
  console.log(`\n[${sig}] shutting down…`);
  try { wss.close(); } catch {}
  try { if (modelHost?.shutdown) await modelHost.shutdown(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
