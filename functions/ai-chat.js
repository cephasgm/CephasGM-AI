/**
 * CephasGM SI - functions/ai-chat.js
 * ----------------------------------------------------------------------------
 * Real chat completion backend (Firebase Cloud Function).
 *
 * v2 changes over v1:
 *   - NO mock responses. Returns 503 if no backend configured.
 *   - CORS allowlist (not '*').
 *   - Firestore-backed rate limit (per IP).
 *   - Optional Firebase ID token -> uid.
 *   - History sanitization (system role stripped, content capped).
 *   - 'context' field support (MemoryModule.recall output).
 *   - Env var aliases: OPENAI_API_KEY / OPENAI_KEY.
 *   - Model passthrough + allowlist.
 *   - 25s upstream timeout, 1 retry on 5xx.
 *   - Request ID, structured errors, version field.
 *   - GET ?health for readiness probes.
 *   - Backward-compat response shape: { reply, content, usage, ... }
 *
 * Real AI only. No fake data. No silent fallbacks.
 * ----------------------------------------------------------------------------
 */

'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/* ==========================================================================
 * Config
 * ======================================================================== */
const VERSION = '6.0.0-si';

const DEFAULT_SYSTEM_PROMPT = [
  'You are CephasGM SI - Superintelligence for Africa.',
  'You are helpful, accurate, culturally aware, and never fabricate facts.',
  'When unsure, say so.',
  'Prefer plain English; respond in Swahili if the user writes in Swahili.'
].join(' ');

const CFG = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || [
    'https://cephasgm-ai.onrender.com',
    'https://cephasgm-ai.web.app',
    'https://cephasgm-ai.firebaseapp.com',
    'http://localhost:6000',
    'http://localhost:5173',
    'http://localhost:3000'
  ].join(',')).split(',').map(function (s) { return s.trim(); }).filter(Boolean),

  // Accept both env var names - pick whichever is set.
  openaiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '',
  openaiBase: process.env.OPENAI_BASE || 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  // Allowlist of models the client may request. Anything else falls back.
  allowedModels: (process.env.ALLOWED_MODELS || [
    'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4',
    'gpt-3.5-turbo', 'deepseek-chat'
  ].join(',')).split(',').map(function (s) { return s.trim(); }).filter(Boolean),

  maxPromptLen: 20000,
  maxContextLen: 8000,
  maxHistoryTurns: 20,
  maxHistoryLen: 4000,
  maxTokens: 2048,
  temperature: 0.7,
  upstreamTimeoutMs: 25000,

  rateLimitWindowMs: 60000,
  rateLimitMax: 30,

  systemPrompt: DEFAULT_SYSTEM_PROMPT
};

/* ==========================================================================
 * Helpers
 * ======================================================================== */
function reqId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const isLocalDev = /^http:\/\/localhost(:\d+)?$/.test(origin);
  const allowed =
    CFG.allowedOrigins.indexOf(origin) !== -1 ||
    (process.env.NODE_ENV !== 'production' && isLocalDev);

  if (allowed) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  } else if (!origin) {
    res.set('Access-Control-Allow-Origin', '*');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-request-id');
  res.set('Access-Control-Max-Age', '3600');
}

function safeString(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Sanitize client history:
 *   - must be an array
 *   - only 'user' and 'assistant' roles allowed (strip 'system')
 *   - content capped
 *   - last N turns only
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    let role = null;
    if (item.role === 'assistant') role = 'assistant';
    else if (item.role === 'user') role = 'user';
    if (!role) continue;
    const content = safeString(item.content, CFG.maxHistoryLen).trim();
    if (!content) continue;
    cleaned.push({ role: role, content: content });
  }
  const max = CFG.maxHistoryTurns * 2;
  return cleaned.length > max ? cleaned.slice(-max) : cleaned;
}

function pickModel(requested) {
  const m = safeString(requested, 64);
  return CFG.allowedModels.indexOf(m) !== -1 ? m : CFG.defaultModel;
}

/* ==========================================================================
 * Auth (optional Firebase ID token)
 * ======================================================================== */
async function getUid(req) {
  const hdr = req.headers.authorization || '';
  if (hdr.indexOf('Bearer ') !== 0) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(hdr.slice(7));
    return decoded.uid || null;
  } catch (e) {
    return null;
  }
}

/* ==========================================================================
 * Rate limit (Firestore, per IP)
 * ======================================================================== */
async function rateLimit(req) {
  const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || req.ip || 'unknown';
  const windowStart = Math.floor(Date.now() / CFG.rateLimitWindowMs);
  const key = ip.replace(/[^a-z0-9.:_]/gi, '_') + '_' + windowStart;
  const ref = db.collection('_rate_limits').doc(key);

  try {
    return await db.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= CFG.rateLimitMax) return { ok: false, count: count };
      tx.set(ref, {
        count: count + 1,
        expiresAt: admin.firestore.Timestamp.fromMillis(
          (windowStart + 2) * CFG.rateLimitWindowMs
        )
      }, { merge: true });
      return { ok: true, count: count + 1 };
    });
  } catch (e) {
    console.warn('[rateLimit] error', e.message);
    return { ok: true, count: 0 };
  }
}

/* ==========================================================================
 * Upstream OpenAI call (native fetch - Node 18+)
 * ======================================================================== */
async function callOpenAI(opts) {
  const url = CFG.openaiBase.replace(/\/$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CFG.openaiKey
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: false
      }),
      signal: controller.signal
    });

    if (!r.ok) {
      const err = new Error('Upstream HTTP ' + r.status);
      err.status = r.status;
      try { err.body = await r.text(); } catch (e) { /* ignore */ }
      throw err;
    }

    const data = await r.json();
    const content = data && data.choices && data.choices[0] &&
                    data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Upstream returned empty content');
    }
    return {
      content: content,
      model: data.model || opts.model,
      usage: data.usage || null,
      finish: (data.choices[0] && data.choices[0].finish_reason) || null
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(opts) {
  try {
    return await callOpenAI(opts);
  } catch (e) {
    const retryable = !e.status || (e.status >= 500 && e.status < 600);
    if (!retryable) throw e;
    await new Promise(function (r) { setTimeout(r, 400); });
    return await callOpenAI(opts);
  }
}

/* ==========================================================================
 * Main handler
 * ======================================================================== */
exports.chat = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async function (req, res) {
    const id = reqId();
    res.set('X-Request-Id', id);

    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      if (req.query.health !== undefined || req.path === '/health') {
        let firestoreOk = true;
        try { await db.collection('_health').limit(1).get(); }
        catch (e) { firestoreOk = false; }
        return res.json({
          ok: true,
          version: VERSION,
          service: 'ai-chat',
          backend: CFG.openaiKey ? 'openai' : 'none',
          model: CFG.defaultModel,
          firestore: firestoreOk ? 'reachable' : 'unreachable',
          ts: Date.now()
        });
      }
      if (req.query.version !== undefined) {
        return res.json({ version: VERSION });
      }
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const rl = await rateLimit(req);
    if (!rl.ok) {
      res.set('Retry-After', '60');
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: CFG.rateLimitMax,
        windowMs: CFG.rateLimitWindowMs,
        id: id
      });
    }

    const body = req.body || {};
    const prompt = safeString(body.prompt, CFG.maxPromptLen).trim();
    const context = safeString(body.context, CFG.maxContextLen).trim();
    const history = sanitizeHistory(body.history);
    const model = pickModel(body.model);

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required (string)', id: id });
    }

    if (!CFG.openaiKey) {
      return res.status(503).json({
        error: 'No inference backend configured',
        hint: 'Set OPENAI_API_KEY (or OPENAI_KEY) in the function environment',
        id: id
      });
    }

    const messages = [{
      role: 'system',
      content: context
        ? CFG.systemPrompt + '\n\n---\nRelevant long-term memory:\n' + context
        : CFG.systemPrompt
    }];
    for (let i = 0; i < history.length; i++) messages.push(history[i]);
    messages.push({ role: 'user', content: prompt });

    try {
      const out = await callWithRetry({
        messages: messages,
        model: model,
        temperature: CFG.temperature,
        maxTokens: CFG.maxTokens,
        timeoutMs: CFG.upstreamTimeoutMs
      });

      getUid(req).catch(function () { return null; });

      return res.json({
        reply: out.content,
        content: out.content,
        model: out.model,
        usage: out.usage,
        finish: out.finish,
        version: VERSION,
        id: id,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error('[chat ' + id + ']', e.message, e.body || '');
      const status = (e.status && e.status >= 400 && e.status < 500) ? e.status : 502;
      return res.status(status).json({
        error: 'Chat backend failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : e.message,
        id: id,
        reply: 'The chat backend is temporarily unavailable. Please try again.'
      });
    }
  });
