/**
 * CephasGM SI — functions/ai-chat.js
 * ----------------------------------------------------------------------------
 * Real chat completion backend (Firebase Cloud Function).
 *
 * v2 changes over v1:
 *   ✓ NO mock responses — returns 503 if no backend configured
 *   ✓ CORS allowlist (not '*')
 *   ✓ Firestore-backed rate limit (per IP)
 *   ✓ Optional Firebase ID token → uid
 *   ✓ History sanitization (system role stripped, content capped)
 *   ✓ `context` field support (MemoryModule.recall output)
 *   ✓ Env var aliases: OPENAI_API_KEY / OPENAI_KEY
 *   ✓ Model passthrough + allowlist
 *   ✓ 25s upstream timeout, 1 retry on 5xx
 *   ✓ Request ID, structured errors, version field
 *   ✓ GET ?health for readiness probes
 *   ✓ Backward-compat response shape: { reply, content, usage, ... }
 *
 * Real AI only. No fake data. No silent fallbacks.
 * ----------------------------------------------------------------------------
 */

'use strict';

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/* ============================================================================
 * Config
 * ========================================================================== */
const VERSION = '6.0.0-si';

const CFG = {
  allowedOrigins: (process.env.ALLOWED_ORIGINS || [
    'https://cephasgm-ai.onrender.com',
    'https://cephasgm-ai.web.app',
    'https://cephasgm-ai.firebaseapp.com',
    'http://localhost:6000',
    'http://localhost:5173',
    'http://localhost:3000'
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean),

  // Accept both env var names — pick whichever is set
  openaiKey:   process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '',
  openaiBase:  process.env.OPENAI_BASE    || 'https://api.openai.com/v1',
  defaultModel:process.env.OPENAI_MODEL   || 'gpt-4o-mini',

  // Allowlist of models the client may request. Anything else → defaultModel.
  allowedModels: (process.env.ALLOWED_MODELS || [
    'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-4',
    'gpt-3.5-turbo', 'deepseek-chat'
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean),

  maxPromptLen:     20_000,
  maxContextLen:    8_000,
  maxHistoryTurns:  20,
  maxHistoryLen:    4_000,       // per message
  maxTokens:        2_048,
  temperature:      0.7,
  upstreamTimeoutMs: 25_000,

  rateLimitWindowMs: 60_000,
  rateLimitMax:      30           // 30 requests / minute / IP

  ,systemPrompt:
`You are CephasGM SI — Superintelligence for Africa.
You are helpful, accurate, culturally aware, and never fabricate facts.
When unsure, say so. Prefer plain English; respond in Swahili if the user writes in Swahili.`
};

/* ============================================================================
 * Helpers
 * ========================================================================== */
function reqId() {
  return (globalThis.crypto?.randomUUID?.() ||
    ('req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)));
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed =
    CFG.allowedOrigins.includes(origin) ||
    (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin));

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
 *   - only `user` and `assistant` roles allowed (strip `system`)
 *   - content capped
 *   - last N turns only
 */
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role === 'assistant' ? 'assistant'
               : item.role === 'user'      ? 'user'
               : null;
    if (!role) continue; // drop system/function/tool
    const content = safeString(item.content, CFG.maxHistoryLen).trim();
    if (!content) continue;
    cleaned.push({ role, content });
  }
  // Keep the most recent N turns
  const max = CFG.maxHistoryTurns * 2;
  return cleaned.length > max ? cleaned.slice(-max) : cleaned;
}

function pickModel(requested) {
  const m = safeString(requested, 64);
  return CFG.allowedModels.includes(m) ? m : CFG.defaultModel;
}

/* ============================================================================
 * Auth (optional Firebase ID token)
 * ========================================================================== */
async function getUid(req) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(hdr.slice(7));
    return decoded.uid || null;
  } catch {
    return null;
  }
}

/* ============================================================================
 * Rate limit (Firestore, per IP)
 * ========================================================================== */
async function rateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.ip || 'unknown';
  const windowStart = Math.floor(Date.now() / CFG.rateLimitWindowMs);
  const key = `${ip.replace(/[^a-z0-9.:_]/gi, '_')}_${windowStart}`;
  const ref = db.collection('_rate_limits').doc(key);

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= CFG.rateLimitMax) return { ok: false, count };
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
    return { ok: true, count: 0 }; // fail open
  }
}

/* ============================================================================
 * Upstream OpenAI call (native fetch — no node-fetch needed on Node 20)
 * ========================================================================== */
async function callOpenAI({ messages, model, temperature, maxTokens, timeoutMs }) {
  const url = `${CFG.openaiBase.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CFG.openaiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: controller.signal
    });

    if (!r.ok) {
      const err = new Error(`Upstream HTTP ${r.status}`);
      err.status = r.status;
      try { err.body = await r.text(); } catch {}
      throw err;
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Upstream returned empty content');
    }
    return {
      content,
      model:    data.model || model,
      usage:    data.usage || null,
      finish:   data.choices?.[0]?.finish_reason || null
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(opts) {
  try {
    return await callOpenAI(opts);
  } catch (e) {
    // Retry once on 5xx or network error
    const retryable =
      !e.status || (e.status >= 500 && e.status < 600);
    if (!retryable) throw e;
    await new Promise(r => setTimeout(r, 400));
    return await callOpenAI(opts);
  }
}

/* ============================================================================
 * Main handler
 * ========================================================================== */
exports.chat = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const id = reqId();
    res.set('X-Request-Id', id);

    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // Health / version
    if (req.method === 'GET') {
      if (req.query.health !== undefined || req.path === '/health') {
        let firestoreOk = true;
        try { await db.collection('_health').limit(1).get(); }
        catch { firestoreOk = false; }
        return res.json({
          ok: true,
          version: VERSION,
          service: 'ai-chat',
          backend: CFG.openaiKey ? 'openai' : 'none',
          model:   CFG.defaultModel,
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

    // Rate limit
    const rl = await rateLimit(req);
    if (!rl.ok) {
      res.set('Retry-After', '60');
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limit: CFG.rateLimitMax,
        windowMs: CFG.rateLimitWindowMs,
        id
      });
    }

    // Read input
    const body    = req.body || {};
    const prompt  = safeString(body.prompt, CFG.maxPromptLen).trim();
    const context = safeString(body.context, CFG.maxContextLen).trim();
    const history = sanitizeHistory(body.history);
    const model   = pickModel(body.model);

    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required (string)', id });
    }

    // If no backend, return a real 503 — never fabricate
    if (!CFG.openaiKey) {
      return res.status(503).json({
        error: 'No inference backend configured',
        hint: 'Set OPENAI_API_KEY (or OPENAI_KEY) in the function environment',
        id
      });
    }

    // Build messages: system (base + optional recall) → history → user
    const messages = [{
      role: 'system',
      content: context
        ? `${CFG.systemPrompt}\n\n---\nRelevant long-term memory:\n${context}`
        : CFG.systemPrompt
    }];
    messages.push(...history);
    messages.push({ role: 'user', content: prompt });

    try {
      const { content, model: usedModel, usage, finish } = await callWithRetry({
        messages,
        model,
        temperature: CFG.temperature,
        maxTokens:   CFG.maxTokens,
        timeoutMs:   CFG.upstreamTimeoutMs
      });

      // Note: uid is captured for future metering; not used yet.
      void getUid(req).catch(() => null);

      // Backward-compatible response: both `reply` (v1) and `content` (v2)
      return res.json({
        reply:    content,
        content:  content,
        model:    usedModel,
        usage,
        finish,
        version:  VERSION,
        id,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error(`[chat ${id}]`, e.message, e.body || '');
      const status = e.status && e.status >= 400 && e.status < 500
        ? e.status : 502;
      return res.status(status).json({
        error: 'Chat backend failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : e.message,
        id,
        reply: 'The chat backend is temporarily unavailable. Please try again.'
      });
    }
  });
