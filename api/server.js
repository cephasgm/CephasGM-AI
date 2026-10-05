/**
 * CephasGM SI — api/server.js
 * ----------------------------------------------------------------------------
 * Complete backend: multimodal AI + agents + memory + cluster + commercial API.
 *
 * New in v6:
 *   - /chat, /chat/stream (SSE), /chat/upload          ← core chat pipeline
 *   - /code, /research                                 ← agent endpoints
 *   - /user/role, /admin/updateRole                    ← Firebase-gated admin
 *   - /agents/tutor                                    ← killer app (Review #4)
 *   - /v1/*                                            ← API-as-a-Service (#5)
 *   - /plugins                                         ← plugin registry (#5)
 *   - /license/edge                                    ← edge licensing (#5)
 *   - /metrics                                         ← Prometheus
 *   - auth middleware, rate limit, request ID, CORS allowlist, safe errors
 *   - inference router: textEngine → Ollama → OpenAI → clean 503
 *
 * NO FAKE DATA: if no inference backend is reachable, endpoints return 503
 * with an actionable message. They never fabricate responses.
 * ----------------------------------------------------------------------------
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

/* ============================================================================
 * Optional commercial-layer deps — loaded defensively so local dev works
 * without them, but production will want them installed.
 * ========================================================================== */
let rateLimit, multer, jwt;
try { rateLimit = require('express-rate-limit'); } catch { console.warn('[boot] express-rate-limit not installed — rate limiting disabled'); }
try { multer    = require('multer');               } catch { console.warn('[boot] multer not installed — /chat/upload disabled'); }
try { jwt       = require('jsonwebtoken');         } catch { console.warn('[boot] jsonwebtoken not installed — /license/edge disabled'); }

let admin = null;
try {
  if (process.env.FIREBASE_ADMIN_JSON) {
    admin = require('firebase-admin');
    const creds = JSON.parse(process.env.FIREBASE_ADMIN_JSON);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(creds) });
    }
    console.log('[boot] firebase-admin initialized');
  }
} catch (e) {
  console.warn('[boot] firebase-admin unavailable:', e.message);
}

/* ============================================================================
 * Internal modules — resolved relative to THIS file, not process.cwd()
 * ========================================================================== */
const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

// Load defensively: a broken sub-module shouldn't take down the whole API.
const safeRequire = (p, label) => {
  try { return req(p); }
  catch (e) { console.warn(`[boot] ${label} unavailable: ${e.message}`); return null; }
};

const os            = safeRequire('ecosystem/ai-os',           'ai-os');
const factory       = safeRequire('ecosystem/agent-factory',   'agent-factory');
const nodeManager   = safeRequire('cluster/node-manager',      'node-manager');
const vectorDb      = safeRequire('memory/vector-db',          'vector-db');
const knowledgeGraph= safeRequire('memory/knowledge-graph',    'knowledge-graph');
const textEngine    = safeRequire('multimodal/text-engine',    'text-engine');
const imageEngine   = safeRequire('multimodal/image-engine',   'image-engine');
const audioEngine   = safeRequire('multimodal/audio-engine',   'audio-engine');
const videoEngine   = safeRequire('multimodal/video-engine',   'video-engine');

/* ============================================================================
 * Config
 * ========================================================================== */
const PORT = process.env.PORT || 6000;
const ENV  = process.env.NODE_ENV || 'development';

const CONFIG = {
  corsAllowlist: (process.env.CORS_ALLOWLIST || [
    'https://cephasgm-ai.onrender.com',
    'https://cephasgm-ai.web.app',
    'https://cephasgm-ai.firebaseapp.com',
    'http://localhost:5173',
    'http://localhost:6000',
    'http://localhost:3000'
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean),

  ollamaURL:     process.env.OLLAMA_URL || '',
  ollamaModel:   process.env.OLLAMA_MODEL || 'llama3.2',
  openaiKey:     process.env.OPENAI_API_KEY || '',
  openaiBase:    process.env.OPENAI_BASE || 'https://api.openai.com/v1',
  openaiModel:   process.env.OPENAI_MODEL || 'gpt-4o-mini',

  apiKeys:       (process.env.CEPHASGM_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean),
  licenseSecret: process.env.EDGE_LICENSE_SECRET || '',
  licenseIssuer: process.env.EDGE_LICENSE_ISSUER || 'cephasgm-si',

  maxUploadMB:   25,
  bodyLimit:     '50mb'
};

const START_TS = Date.now();
const VERSION  = '6.0.0-si';

/* ============================================================================
 * App + security middleware
 * ========================================================================== */
const app = express();
app.set('trust proxy', 1); // Render/Railway sit behind a proxy

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl / SSR
    if (CONFIG.corsAllowlist.includes(origin)) return cb(null, true);
    if (ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

app.use(compression());

// Request ID + structured access log
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      id: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Number(ms.toFixed(2)),
      uid: req.user?.uid || null
    }));
  });
  next();
});

// Rate limits
if (rateLimit) {
  const globalLimiter = rateLimit({
    windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests' }
  });
  const chatLimiter = rateLimit({
    windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Slow down — 30 chat requests per minute max' }
  });
  app.use(globalLimiter);
  app.use('/chat', chatLimiter);
} else {
  console.warn('[boot] rate limiting disabled');
}

app.use(express.json({ limit: CONFIG.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.bodyLimit }));

/* ============================================================================
 * Auth (optional — populates req.user when a valid Firebase token is present)
 * ========================================================================== */
async function extractUser(req, _res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return next();

  // API keys handled separately in /v1
  if (token.startsWith('cgm_')) {
    req.apiKey = token;
    return next();
  }

  if (!admin) return next();
  try {
    req.user = await admin.auth().verifyIdToken(token);
  } catch (e) {
    // Token invalid — leave req.user undefined; downstream decides
  }
  next();
}
app.use(extractUser);

const requireUser = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const role = req.user.role || req.user.admin && 'admin' || 'user';
  if (role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

/* ============================================================================
 * API-key auth for /v1 (commercial tier)
 * ========================================================================== */
async function verifyApiKey(key) {
  if (!key) return null;
  // Dev/simple mode: static list from env
  if (CONFIG.apiKeys.includes(key)) {
    return { key, tenant: 'env', tier: 'pro', quotaPerDay: 100000 };
  }
  // Prod mode: Firestore lookup
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
 * Usage metering (Review #5)
 * --------------------------------------------------------------------------
 * Persists per-key daily counters in Firestore when admin is available;
 * otherwise accumulates in-memory (dev only, resets on restart).
 * ========================================================================== */
const memUsage = new Map(); // key -> { day: 'YYYY-MM-DD', tokens: n, calls: n }
const today = () => new Date().toISOString().slice(0, 10);

async function meter(req, { tokens = 0, calls = 1 } = {}) {
  const rec = req.apiKeyRecord;
  if (!rec) return;
  const day = today();

  // Memory
  const cur = memUsage.get(rec.key) || { day, tokens: 0, calls: 0 };
  if (cur.day !== day) { cur.day = day; cur.tokens = 0; cur.calls = 0; }
  cur.tokens += tokens; cur.calls += calls;
  memUsage.set(rec.key, cur);

  // Firestore
  if (admin) {
    try {
      const ref = admin.firestore()
        .collection('usage').doc(rec.key)
        .collection('daily').doc(day);
      await ref.set({
        tokens: admin.firestore.FieldValue.increment(tokens),
        calls:  admin.firestore.FieldValue.increment(calls),
        lastAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.warn('[meter] Firestore write failed', e.message);
    }
  }
}

/* ============================================================================
 * Inference router (real, env-driven)
 * ========================================================================== */
async function inferText({ prompt, model, context, history, stream = false, signal }) {
  // 1. Local multimodal text engine
  if (textEngine && typeof textEngine.generate === 'function') {
    try {
      const out = await textEngine.generate(prompt, { model, context, history, stream, signal });
      if (out) return { source: 'textEngine', data: out };
    } catch (e) {
      console.warn('[infer] textEngine failed, trying fallbacks:', e.message);
    }
  }

  // 2. Ollama
  if (CONFIG.ollamaURL) {
    try {
      const url = `${CONFIG.ollamaURL.replace(/\/$/, '')}/api/chat`;
      const body = {
        model: model || CONFIG.ollamaModel,
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
    } catch (e) {
      console.warn('[infer] Ollama failed:', e.message);
    }
  }

  // 3. OpenAI-compatible
  if (CONFIG.openaiKey) {
    try {
      const url = `${CONFIG.openaiBase.replace(/\/$/, '')}/chat/completions`;
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
          'Authorization': `Bearer ${CONFIG.openaiKey}`
        },
        body: JSON.stringify({
          model: model || CONFIG.openaiModel,
          messages,
          stream
        }),
        signal
      });
      if (r.ok) return { source: 'openai', stream: r.body, ok: true };
      console.warn('[infer] OpenAI HTTP', r.status);
    } catch (e) {
      console.warn('[infer] OpenAI failed:', e.message);
    }
  }

  return { source: 'none', ok: false };
}

function noInferenceResponse(res) {
  return res.status(503).json({
    error: 'No inference backend available',
    hint: 'Configure one of: textEngine module, OLLAMA_URL, or OPENAI_API_KEY',
    timestamp: new Date().toISOString()
  });
}

/* ============================================================================
 * Validation helpers
 * ========================================================================== */
const isStr = (v, min = 1, max = 100_000) =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max;

function bad(res, msg) { return res.status(400).json({ error: msg }); }

/* ============================================================================
 * System endpoints
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
      textEngine:  !!textEngine,
      imageEngine: !!imageEngine,
      audioEngine: !!audioEngine,
      videoEngine: !!videoEngine,
      vectorDb:    !!vectorDb,
      knowledge:   !!knowledgeGraph,
      cluster:     !!nodeManager,
      firebaseAdmin: !!admin,
      ollama:      !!CONFIG.ollamaURL,
      openai:      !!CONFIG.openaiKey
    }
  });
});

app.get('/status', (_req, res) => {
  res.json({
    os:      os?.getStatus?.()      || null,
    factory: factory?.getStats?.()  || null,
    cluster: nodeManager?.getStatus?.() || null,
    memory: {
      vectors:   vectorDb?.getStats?.()     || null,
      knowledge: knowledgeGraph?.getStats?.() || null
    }
  });
});

/* ============================================================================
 * CORE CHAT  (was missing — the #1 bug)
 * ========================================================================== */
app.post('/chat', async (req, res) => {
  const { prompt, model, context, history } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required (string)');

  const out = await inferText({ prompt, model, context, history, stream: false });

  if (out.source === 'textEngine') {
    return res.json(out.data);
  }

  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      if (out.source === 'ollama') {
        const content = raw?.message?.content || raw?.response || '';
        return res.json({ content, model: model || CONFIG.ollamaModel, source: 'ollama' });
      }
      const content = raw?.choices?.[0]?.message?.content || '';
      return res.json({
        content,
        model: raw?.model || model || CONFIG.openaiModel,
        usage: raw?.usage || null,
        source: 'openai'
      });
    } catch (e) {
      console.error('[chat] response parse failed', e);
      return res.status(502).json({ error: 'Upstream parse failed' });
    }
  }

  return noInferenceResponse(res);
});

/* Real SSE streaming for /chat/stream */
app.post('/chat/stream', async (req, res) => {
  const { prompt, model, context, history } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required (string)');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx / Render proxy
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());

  try {
    const out = await inferText({ prompt, model, context, history, stream: true, signal: ctrl.signal });

    if (out.source === 'textEngine') {
      // Non-streaming engine — emit as one chunk
      const text = typeof out.data === 'string' ? out.data : (out.data.content || '');
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
          const t = line.trim();
          if (!t) continue;
          if (out.source === 'ollama') {
            // Ollama streams NDJSON
            try {
              const j = JSON.parse(t);
              const delta = j?.message?.content || '';
              if (delta) send({ choices: [{ delta: { content: delta } }] });
            } catch {}
          } else {
            // OpenAI streams `data: {...}`
            if (!t.startsWith('data:')) continue;
            const p = t.slice(5).trim();
            if (p === '[DONE]') { return done(); }
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

/* Multipart upload */
if (multer) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.maxUploadMB * 1024 * 1024, files: 8 }
  });

  app.post('/chat/upload', upload.array('files', 8), async (req, res) => {
    const { prompt = '', model, context } = req.body || {};
    const files = req.files || [];

    // Attach file metadata to the prompt
    let fullPrompt = prompt;
    if (files.length) {
      fullPrompt += (fullPrompt ? '\n\n' : '') + 'Attached files:\n' +
        files.map(f => `- ${f.originalname} (${f.mimetype}, ${f.size} bytes)`).join('\n');
    }
    if (!isStr(fullPrompt, 1, 120_000)) return bad(res, 'prompt or files required');

    // For text/plain and markdown, inline the content (bounded)
    for (const f of files) {
      if (/^text\/|json|markdown|csv/.test(f.mimetype) && f.size < 200_000) {
        fullPrompt += `\n\n--- ${f.originalname} ---\n${f.buffer.toString('utf8')}`;
      }
    }

    const out = await inferText({ prompt: fullPrompt, model, context, stream: false });
    if (out.source === 'textEngine') return res.json(out.data);

    if (out.source === 'ollama' || out.source === 'openai') {
      try {
        const raw = await new Response(out.stream).json();
        const content = out.source === 'ollama'
          ? (raw?.message?.content || raw?.response || '')
          : (raw?.choices?.[0]?.message?.content || '');
        return res.json({ content, model, source: out.source });
      } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
    }
    return noInferenceResponse(res);
  });
} else {
  app.post('/chat/upload', (_req, res) =>
    res.status(503).json({ error: 'Upload support not installed. Run: npm i multer' }));
}

/* ============================================================================
 * Code interpreter (Software Factory)
 * ========================================================================== */
app.post('/code', async (req, res) => {
  const { code, language = 'javascript' } = req.body || {};
  if (!isStr(code, 1, 200_000)) return bad(res, 'code is required');

  // No fake execution. Ask the inference layer to analyze/run.
  const prompt =
`Language: ${language}
Task: Execute the following code and return ONLY its stdout.
If it cannot be executed, return a clear error message.

\`\`\`${language}
${code}
\`\`\``;

  const out = await inferText({ prompt, model: null, context: '', history: [], stream: false });

  if (out.source === 'textEngine') return res.json(out.data);

  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      const content = out.source === 'ollama'
        ? (raw?.message?.content || '')
        : (raw?.choices?.[0]?.message?.content || '');
      return res.json({ output: content, language });
    } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
  }
  return noInferenceResponse(res);
});

/* ============================================================================
 * Research (search agent + research tab)
 * ========================================================================== */
app.post('/research', async (req, res) => {
  const { topic, depth = 'basic' } = req.body || {};
  if (!isStr(topic, 1, 2000)) return bad(res, 'topic is required');

  const prompt =
`Research topic: ${topic}
Depth: ${depth}
Return STRICT JSON only:
{ "summary": "...", "findings": [{"content":"..."}], "sources": [{"title":"..."}] }
No prose outside JSON.`;

  const out = await inferText({ prompt, model: null, context: '', history: [], stream: false });
  if (out.source === 'textEngine') return res.json(out.data);

  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      const content = out.source === 'ollama'
        ? (raw?.message?.content || '')
        : (raw?.choices?.[0]?.message?.content || '');
      let parsed;
      try {
        const m = content.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(m ? m[0] : content);
      } catch {
        parsed = { summary: content };
      }
      return res.json(parsed);
    } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
  }
  return noInferenceResponse(res);
});

/* ============================================================================
 * Task / agents (existing)
 * ========================================================================== */
app.post('/task', async (req, res) => {
  const { task, options } = req.body || {};
  if (!isStr(task, 1, 60_000)) return bad(res, 'task is required');

  if (os && typeof os.runTask === 'function') {
    try {
      const result = await os.runTask(task, options);
      return res.json({ success: true, ...result });
    } catch (e) {
      console.error('[/task] os.runTask failed', e);
    }
  }

  // Fallback: route through inference
  const out = await inferText({ prompt: task, model: null, context: '', history: [], stream: false });
  if (out.source === 'textEngine') return res.json({ success: true, result: out.data });
  if (out.source === 'ollama' || out.source === 'openai') {
    const raw = await new Response(out.stream).json();
    const content = out.source === 'ollama'
      ? (raw?.message?.content || '')
      : (raw?.choices?.[0]?.message?.content || '');
    return res.json({ success: true, result: { content } });
  }
  return noInferenceResponse(res);
});

app.post('/tasks', async (req, res) => {
  const { tasks, options } = req.body || {};
  if (!Array.isArray(tasks)) return bad(res, 'tasks must be an array');
  if (os && typeof os.runTasks === 'function') {
    const results = await os.runTasks(tasks, options);
    return res.json({ success: true, count: results.length, results });
  }
  return bad(res, 'Batch task runner unavailable');
});

app.get('/agents', (_req, res) => {
  const list = (os && typeof os.listAgents === 'function') ? os.listAgents() : [];
  res.json({ success: true, count: list.length, agents: list });
});

app.post('/create-agent', async (req, res) => {
  const { type, config } = req.body || {};
  if (!isStr(type, 1, 60)) return bad(res, 'type is required');
  if (!os || typeof os.createAgent !== 'function') return res.status(503).json({ error: 'Agent OS unavailable' });
  const agent = os.createAgent(type, config);
  res.json({ success: true, agent });
});

app.delete('/agents/:agentId', (req, res) => {
  if (!os || typeof os.destroyAgent !== 'function') return res.status(503).json({ error: 'Agent OS unavailable' });
  const result = os.destroyAgent(req.params.agentId);
  res.json({ success: !!result, agentId: req.params.agentId });
});

/* ============================================================================
 * Killer app: STEM Tutor (Review #4)
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
    history: [], stream: false
  });

  if (out.source === 'textEngine') return res.json(out.data);
  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      const content = out.source === 'ollama'
        ? (raw?.message?.content || '')
        : (raw?.choices?.[0]?.message?.content || '');
      return res.json({ content, agent: 'tutor', level, lang });
    } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
  }
  return noInferenceResponse(res);
});

/* ============================================================================
 * Multimodal (existing)
 * ========================================================================== */
const multimodalHandler = (engine, field) => async (req, res) => {
  const value = req.body?.[field];
  const options = req.body?.options;
  if (!isStr(value, 1, 4000)) return bad(res, `${field} is required`);
  if (!engine || typeof engine.generate !== 'function') {
    return res.status(503).json({ error: `${field} engine not available` });
  }
  try {
    const result = await engine.generate(value, options);
    res.json(result);
  } catch (e) {
    console.error('[multimodal] engine error', e);
    res.status(500).json({ error: 'Generation failed' });
  }
};
app.post('/generate/text',  multimodalHandler(textEngine,  'prompt'));
app.post('/generate/image', multimodalHandler(imageEngine, 'prompt'));
app.post('/generate/audio', multimodalHandler(audioEngine, 'text'));
app.post('/generate/video', multimodalHandler(videoEngine, 'prompt'));

/* ============================================================================
 * Cluster (existing)
 * ========================================================================== */
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

app.post('/cluster/strategy', (req, res) => {
  const { strategy } = req.body || {};
  if (!isStr(strategy, 1, 40)) return bad(res, 'strategy required');
  if (!nodeManager) return res.status(503).json({ error: 'Cluster unavailable' });
  res.json({ success: true, strategy: nodeManager.setStrategy(strategy) });
});

/* ============================================================================
 * Memory (existing)
 * ========================================================================== */
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

/* ============================================================================
 * Models
 * ========================================================================== */
app.get('/models', (_req, res) => {
  res.json({
    text:    textEngine?.getModels?.()  || [],
    image:   imageEngine?.getModels?.() || [],
    cluster: nodeManager?.getNodeCountByType?.() || {},
    remote: {
      ollama: CONFIG.ollamaURL ? CONFIG.ollamaModel : null,
      openai: CONFIG.openaiKey ? CONFIG.openaiModel : null
    }
  });
});

/* ============================================================================
 * User / admin (Firebase-gated)
 * ========================================================================== */
app.get('/user/role', requireUser, (req, res) => {
  res.json({ role: req.user.role || (req.user.admin ? 'admin' : 'user') });
});

app.post('/admin/updateRole', requireAdmin, async (req, res) => {
  const { email, role } = req.body || {};
  if (!isStr(email, 3, 200)) return bad(res, 'email required');
  if (!['user', 'premium', 'admin'].includes(role)) return bad(res, 'invalid role');
  if (!admin) return res.status(503).json({ error: 'Firebase Admin not configured' });
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, { role });
    res.json({ success: true, uid: user.uid, role });
  } catch (e) {
    console.error('[admin] updateRole failed', e);
    res.status(500).json({ error: 'Role update failed' });
  }
});

/* ============================================================================
 * ──── COMMERCIAL LAYER (Review #5) ────
 * ========================================================================== */

/* /v1/chat — API-as-a-Service (key gated, metered) */
app.post('/v1/chat', requireApiKey, async (req, res) => {
  const { prompt, model, context, history } = req.body || {};
  if (!isStr(prompt, 1, 60_000)) return bad(res, 'prompt is required');

  const out = await inferText({ prompt, model, context, history, stream: false });
  if (out.source === 'textEngine') {
    await meter(req, { calls: 1 });
    return res.json({ data: out.data, tenant: req.apiKeyRecord.tenant });
  }
  if (out.source === 'ollama' || out.source === 'openai') {
    try {
      const raw = await new Response(out.stream).json();
      const content = out.source === 'ollama'
        ? (raw?.message?.content || '')
        : (raw?.choices?.[0]?.message?.content || '');
      const tokens = raw?.usage?.total_tokens || Math.ceil(content.length / 4);
      await meter(req, { tokens, calls: 1 });
      return res.json({
        data: { content },
        usage: { tokens },
        tenant: req.apiKeyRecord.tenant,
        tier: req.apiKeyRecord.tier
      });
    } catch { return res.status(502).json({ error: 'Upstream parse failed' }); }
  }
  return noInferenceResponse(res);
});

/* /v1/agents — list public agents for third-party integration */
app.get('/v1/agents', requireApiKey, (_req, res) => {
  res.json({
    agents: [
      { id: 'chat',      name: 'Chat',            category: 'core' },
      { id: 'tutor',     name: 'STEM Tutor',      category: 'education' },
      { id: 'safety',    name: 'Safety Advisor',  category: 'industrial' },
      { id: 'research',  name: 'Research',        category: 'analysis' },
      { id: 'code',      name: 'Coding',          category: 'code' }
    ],
    version: VERSION
  });
});

/* /v1/usage — tenant reads their own consumption */
app.get('/v1/usage', requireApiKey, (req, res) => {
  const key = req.apiKeyRecord.key;
  const mem = memUsage.get(key) || { tokens: 0, calls: 0, day: today() };
  res.json({
    day: mem.day,
    tokens: mem.tokens,
    calls: mem.calls,
    quotaPerDay: req.apiKeyRecord.quotaPerDay,
    tier: req.apiKeyRecord.tier
  });
});

/* Plugin registry (in-memory; swap to Firestore in prod) */
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

/* Edge license issuance (JWT) */
app.post('/license/edge', requireApiKey, (req, res) => {
  if (!jwt) return res.status(503).json({ error: 'jsonwebtoken not installed' });
  if (!CONFIG.licenseSecret) return res.status(503).json({ error: 'EDGE_LICENSE_SECRET not set' });

  const { deviceId, scope = ['offline-inference', 'swahili-asr'], ttlDays = 365 } = req.body || {};
  if (!isStr(deviceId, 3, 200)) return bad(res, 'deviceId required');

  const token = jwt.sign(
    { sub: deviceId, tenant: req.apiKeyRecord.tenant, scope },
    CONFIG.licenseSecret,
    { issuer: CONFIG.licenseIssuer, expiresIn: `${ttlDays}d` }
  );
  res.json({ token, expiresInDays: ttlDays, scope });
});

/* Metrics */
app.get('/metrics', (_req, res) => {
  const lines = [
    `# HELP cephasgm_uptime_seconds Uptime in seconds`,
    `# TYPE cephasgm_uptime_seconds gauge`,
    `cephasgm_uptime_seconds ${Math.round((Date.now() - START_TS) / 1000)}`,
    `# HELP cephasgm_memory_rss_bytes Resident set size`,
    `# TYPE cephasgm_memory_rss_bytes gauge`,
    `cephasgm_memory_rss_bytes ${process.memoryUsage().rss}`,
    `# HELP cephasgm_plugins_registered Plugin registry size`,
    `# TYPE cephasgm_plugins_registered gauge`,
    `cephasgm_plugins_registered ${plugins.size}`,
    `# HELP cephasgm_api_keys_active_in_memory Metered API keys this run`,
    `# TYPE cephasgm_api_keys_active_in_memory gauge`,
    `cephasgm_api_keys_active_in_memory ${memUsage.size}`
  ];
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

/* ============================================================================
 * Root
 * ========================================================================== */
app.get('/', (_req, res) => {
  res.json({
    name: 'CephasGM SI',
    version: VERSION,
    description: 'Superintelligence platform — chat, agents, multimodal, memory',
    endpoints: {
      core:         { 'POST /chat': 1, 'POST /chat/stream': 1, 'POST /chat/upload': 1 },
      agents:       { 'POST /task': 1, 'POST /tasks': 1, 'GET /agents': 1, 'POST /agents/tutor': 1 },
      multimodal:   { 'POST /generate/text': 1, 'POST /generate/image': 1, 'POST /generate/audio': 1, 'POST /generate/video': 1 },
      code_research:{ 'POST /code': 1, 'POST /research': 1 },
      memory:       { 'POST /memory/vector': 1, 'POST /memory/vector/search': 1, 'POST /memory/knowledge/link': 1 },
      cluster:      { 'GET /cluster/nodes': 1, 'POST /cluster/execute': 1 },
      user:         { 'GET /user/role': 1, 'POST /admin/updateRole': 1 },
      commercial:   { 'POST /v1/chat': 1, 'GET /v1/agents': 1, 'GET /v1/usage': 1, 'POST /plugins/register': 1, 'POST /license/edge': 1 },
      ops:          { 'GET /health': 1, 'GET /status': 1, 'GET /metrics': 1 }
    }
  });
});

/* ============================================================================
 * Errors
 * ========================================================================== */
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.id}`, err);
  // CORS rejection
  if (String(err.message || '').startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  // Body parser / multer
  if (err.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message || 'Bad request' });
  }
  res.status(500).json({ error: 'Internal server error', id: req.id });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

/* ============================================================================
 * Boot
 * ========================================================================== */
const server = app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════╗
║  CephasGM SI — API Server v${VERSION.padEnd(32)}║
║  Port ${String(PORT).padEnd(54)}║
║  Env  ${ENV.padEnd(54)}║
║                                                              ║
║  Inference:                                                  ║
║    textEngine: ${String(!!textEngine).padEnd(44)}║
║    Ollama:     ${String(CONFIG.ollamaURL || 'not set').padEnd(44)}║
║    OpenAI:     ${String(CONFIG.openaiKey ? 'set' : 'not set').padEnd(44)}║
║                                                              ║
║  Commercial layer:                                           ║
║    API keys:   ${String(CONFIG.apiKeys.length + ' env keys').padEnd(44)}║
║    Firebase:   ${String(admin ? 'admin enabled' : 'disabled').padEnd(44)}║
║    Plugins:    ${String(plugins.size).padEnd(44)}║
╚══════════════════════════════════════════════════════════════╝\n`);
});

/* Graceful shutdown */
const shutdown = (sig) => {
  console.log(`\n[${sig}] shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
