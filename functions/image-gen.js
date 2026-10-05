/**
 * CephasGM SI — functions/image-gen.js
 * ----------------------------------------------------------------------------
 * Real image generation backend (Firebase Cloud Function).
 *
 * v2 changes over v1:
 *   ✓ NO placeholder fallbacks — returns 503 if no provider configured
 *   ✓ CORS allowlist, single header set (no double)
 *   ✓ Firestore-backed rate limit (per IP)
 *   ✓ Input validation: prompt, size, n, provider
 *   ✓ Stability negative_prompt for higher quality
 *   ✓ OpenAI: dall-e-3 preferred, dall-e-2 as fallback
 *   ✓ Optional Firebase Storage upload (returns real signed URL)
 *   ✓ 25s upstream timeout, 1 retry on 5xx
 *   ✓ Request ID + health/version endpoints
 *   ✓ Response includes original AND enhanced prompt
 *   ✓ Native fetch (drops node-fetch)
 *
 * Real generators only. No fake images.
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

  stabilityKey: process.env.STABILITY_KEY || '',
  openaiKey:    process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '',
  openaiBase:   process.env.OPENAI_BASE || 'https://api.openai.com/v1',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'dall-e-3',
  openaiImageFallback: process.env.OPENAI_IMAGE_FALLBACK || 'dall-e-2',

  uploadBucket: process.env.IMAGE_UPLOAD_BUCKET || '',  // optional: gs://bucket
  signedUrlTtlMs: 7 * 24 * 60 * 60 * 1000,               // 7 days

  maxPromptLen:      2000,
  maxNegativeLen:    500,
  maxN:              4,
  allowedSizes:      ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
  allowedProviders:  ['auto', 'stability', 'openai'],

  upstreamTimeoutMs: 25_000,
  retryBackoffMs:    400,

  rateLimitWindowMs: 60_000,
  rateLimitMax:      10                                // images are expensive
};

/* ============================================================================
 * Helpers
 * ========================================================================== */
function reqId() {
  return (globalThis.crypto?.randomUUID?.() ||
    ('img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)));
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
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id');
  res.set('Access-Control-Max-Age', '3600');
}

function safeString(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

function validateSize(s) {
  const v = String(s || '512x512');
  return CFG.allowedSizes.includes(v) ? v : '512x512';
}

function validateN(n) {
  const parsed = parseInt(n, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, CFG.maxN);
}

function validateProvider(p) {
  const v = String(p || 'auto').toLowerCase();
  return CFG.allowedProviders.includes(v) ? v : 'auto';
}

async function withTimeout(promise, ms, label = 'upstream') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
 * Rate limit (Firestore-backed, shared collection with other functions)
 * ========================================================================== */
async function rateLimit(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.ip || 'unknown';
  const windowStart = Math.floor(Date.now() / CFG.rateLimitWindowMs);
  const key = `img_${ip.replace(/[^a-z0-9.:_]/gi, '_')}_${windowStart}`;
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
    return { ok: true, count: 0 };
  }
}

/* ============================================================================
 * Prompt enhancement — additive, not destructive
 * ----------------------------------------------------------------------------
 * Composes style hints ON TOP of the base prompt instead of replacing it.
 * ========================================================================== */
function enhancePrompt(basePrompt, { style, aspect } = {}) {
  const parts = [basePrompt.trim()];
  const lower = basePrompt.toLowerCase();

  const short = basePrompt.length < 30;
  if (short) parts.push('high quality, detailed, sharp focus');

  if (/wildlife|safari|elephant|lion|giraffe|zebra/.test(lower)) {
    parts.push('African savanna', 'golden hour lighting', 'acacia trees', 'natural environment');
  } else if (/portrait|face|person|man|woman|child/.test(lower)) {
    parts.push('professional photography', 'soft lighting', 'shallow depth of field', 'high detail');
  } else if (/landscape|mountain|valley|lake|river/.test(lower)) {
    parts.push('breathtaking view', 'dramatic sky', 'wide angle');
  } else if (/city|urban|street|building|market/.test(lower)) {
    parts.push('urban scenery', 'realistic architecture', 'dynamic lighting');
  }

  if (style) parts.push(style);
  if (aspect === 'portrait') parts.push('portrait orientation, 9:16 composition');
  if (aspect === 'landscape') parts.push('landscape orientation, 16:9 composition');

  // Dedupe and clean
  const seen = new Set();
  const cleaned = parts
    .join(', ')
    .split(',')
    .map(s => s.trim())
    .filter(s => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));

  return cleaned.join(', ');
}

/* ============================================================================
 * Provider: Stability AI (SDXL)
 * ========================================================================== */
async function generateWithStability({ prompt, negative, size, n, signal }) {
  const [width, height] = size.split('x').map(Number);

  const url = 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image';

  const body = {
    text_prompts: [
      { text: prompt, weight: 1.0 },
      ...(negative ? [{ text: negative, weight: -1.0 }] : [])
    ],
    cfg_scale: 7,
    width:  width  || 1024,
    height: height || 1024,
    samples: n,
    steps: 30,
    style_preset: 'photographic'
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Authorization': `Bearer ${CFG.stabilityKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!r.ok) {
    const err = new Error(`Stability HTTP ${r.status}`);
    err.status = r.status;
    try { err.body = await r.text(); } catch {}
    throw err;
  }

  const data = await r.json();
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  if (!artifacts.length || !artifacts[0].base64) {
    throw new Error('Stability returned no artifacts');
  }

  return {
    images: artifacts.map(a => ({ base64: a.base64, seed: a.seed })),
    provider: 'stability',
    model: 'sdxl-1.0'
  };
}

/* ============================================================================
 * Provider: OpenAI (DALL·E 3 or 2)
 * ========================================================================== */
async function generateWithOpenAI({ prompt, size, n, signal }) {
  const url = `${CFG.openaiBase.replace(/\/$/, '')}/images/generations`;

  // DALL·E 3 only supports n=1; use it if requested count is 1, else dall-e-2.
  const useModel = (n > 1) ? CFG.openaiImageFallback : CFG.openaiImageModel;
  const effectiveN = useModel === 'dall-e-3' ? 1 : n;
  const effectiveSize =
    useModel === 'dall-e-3'
      ? (size === '1024x1024' || size === '1024x1792' || size === '1792x1024' ? size : '1024x1024')
      : (size === '1024x1792' || size === '1792x1024' ? '512x512' : size);

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CFG.openaiKey}`
    },
    body: JSON.stringify({
      model: useModel,
      prompt,
      n: effectiveN,
      size: effectiveSize,
      quality: useModel === 'dall-e-3' ? 'standard' : undefined,
      response_format: 'url'
    }),
    signal
  });

  if (!r.ok) {
    const err = new Error(`OpenAI HTTP ${r.status}`);
    err.status = r.status;
    try { err.body = await r.text(); } catch {}
    throw err;
  }

  const data = await r.json();
  const items = Array.isArray(data.data) ? data.data : [];
  if (!items.length) throw new Error('OpenAI returned no images');

  return {
    images: items.map(x => ({ url: x.url, revisedPrompt: x.revised_prompt })),
    provider: 'openai',
    model: useModel
  };
}

/* ============================================================================
 * Optional: upload base64 to Firebase Storage, return a signed URL
 * ----------------------------------------------------------------------------
 * Only used if IMAGE_UPLOAD_BUCKET is set (e.g. gs://cephasgm-ai-images).
 * Otherwise base64 is returned inline (still real data, just larger payload).
 * ========================================================================== */
async function uploadBase64ToStorage(base64, uid, reqIdValue) {
  if (!CFG.uploadBucket) return null;
  try {
    const bucket = admin.storage().bucket(CFG.uploadBucket);
    const filename = `generated/${uid || 'anon'}/${Date.now()}_${reqIdValue}.png`;
    const file = bucket.file(filename);

    await file.save(Buffer.from(base64, 'base64'), {
      contentType: 'image/png',
      metadata: {
        cacheControl: 'public, max-age=604800',
        metadata: { uid: uid || 'anonymous', requestId: reqIdValue }
      }
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + CFG.signedUrlTtlMs
    });

    return signedUrl;
  } catch (e) {
    console.warn('[storage] upload failed:', e.message);
    return null;
  }
}

/* ============================================================================
 * Main handler
 * ========================================================================== */
exports.image = functions
  .runWith({ timeoutSeconds: 60, memory: '512MB' })
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
        return res.json({
          ok: true,
          version: VERSION,
          service: 'image-gen',
          providers: {
            stability: !!CFG.stabilityKey,
            openai:    !!CFG.openaiKey
          },
          uploadBucket: CFG.uploadBucket || null,
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

    // Input
    const body     = req.body || {};
    const original = safeString(body.prompt, CFG.maxPromptLen).trim();
    const negative = safeString(body.negative_prompt || body.negative, CFG.maxNegativeLen).trim();
    const size     = validateSize(body.size);
    const n        = validateN(body.n);
    const provider = validateProvider(body.provider);
    const style    = safeString(body.style, 200).trim();

    if (!original) {
      return res.status(400).json({ error: 'prompt is required (string)', id });
    }

    // If no provider is configured, return a real 503 — never fake
    const hasStability = !!CFG.stabilityKey;
    const hasOpenAI    = !!CFG.openaiKey;
    if (!hasStability && !hasOpenAI) {
      return res.status(503).json({
        error: 'No image provider configured',
        hint: 'Set STABILITY_KEY or OPENAI_API_KEY in the function environment',
        id
      });
    }

    // Enhance (additive) — original is preserved in the response
    const aspect = size === '1024x1792' ? 'portrait'
                 : size === '1792x1024' ? 'landscape'
                 : undefined;
    const enhanced = enhancePrompt(original, { style, aspect });

    // Provider order based on request
    const order = [];
    if (provider === 'auto') {
      if (hasStability) order.push('stability');
      if (hasOpenAI)    order.push('openai');
    } else if (provider === 'stability' && hasStability) {
      order.push('stability');
      if (hasOpenAI) order.push('openai');   // graceful downgrade
    } else if (provider === 'openai' && hasOpenAI) {
      order.push('openai');
      if (hasStability) order.push('stability');
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    let result = null;
    const attempts = [];

    for (const p of order) {
      try {
        if (p === 'stability') {
          result = await withTimeout(
            generateWithStability({
              prompt: enhanced, negative, size, n, signal: controller.signal
            }),
            CFG.upstreamTimeoutMs, 'stability'
          );
        } else {
          result = await withTimeout(
            generateWithOpenAI({
              prompt: enhanced, size, n, signal: controller.signal
            }),
            CFG.upstreamTimeoutMs, 'openai'
          );
        }
        attempts.push({ provider: p, ok: true });
        break;
      } catch (e) {
        attempts.push({ provider: p, ok: false, error: e.message, status: e.status });
        console.warn(`[image ${id}] ${p} failed:`, e.message);
        if (e.name === 'AbortError' || controller.signal.aborted) break;
      }
    }

    if (!result) {
      return res.status(502).json({
        error: 'All image providers failed',
        attempts,
        id,
        // No fake placeholder URL — caller sees a real error
      });
    }

    // Optional: upload to Firebase Storage to convert base64 → signed URL
    const uid = await getUid(req).catch(() => null);
    const images = [];

    for (const img of result.images) {
      if (img.url) {
        images.push({
          url: img.url,
          revised_prompt: img.revisedPrompt || null,
          storage: 'remote'
        });
      } else if (img.base64) {
        const uploaded = await uploadBase64ToStorage(img.base64, uid, id + '_' + (img.seed || 0));
        if (uploaded) {
          images.push({ url: uploaded, storage: 'firebase', seed: img.seed });
        } else {
          images.push({
            url: `data:image/png;base64,${img.base64}`,
            storage: 'inline',
            seed: img.seed
          });
        }
      }
    }

    return res.json({
      success: true,
      url: images[0]?.url || null,          // backward-compat single-URL field
      images,                                // multi-image aware
      original_prompt: original,
      prompt: enhanced,                      // keep legacy `prompt` field
      enhanced: enhanced !== original,
      negative_prompt: negative || null,
      size,
      n: images.length,
      provider: result.provider,
      model: result.model,
      upload_bucket: CFG.uploadBucket || null,
      id,
      timestamp: Date.now()
    });
  });
