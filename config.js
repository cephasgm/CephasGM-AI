/**
 * CephasGM SI — config.js
 * ----------------------------------------------------------------------------
 * Single source of truth for frontend configuration.
 * Load FIRST — before app.js, ai.js, agents.js, voice.js, memory.js, image.js.
 *
 * Backwards compatible: every field that legacy code reads (API_URL, FIREBASE,
 * MODELS, FEATURES, UI, DEBUG) is preserved with the same shape.
 *
 * New in v6:
 *   - API_URLS[] fallback chain + LOCAL_URL for Ollama
 *   - ENV auto-detection (dev / staging / production)
 *   - MODEL_CATALOG with provider + tier metadata
 *   - OFFLINE, I18N, SW, COMMERCIAL blocks
 *   - Frozen object — no downstream mutation
 * ----------------------------------------------------------------------------
 */

(function () {
  'use strict';

  /* ==========================================================================
   * Environment detection (no build step required)
   * ======================================================================== */
  const host = (typeof location !== 'undefined' && location.hostname) || '';
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local');

  const ENV =
    isLocal ? 'development' :
    /staging|preview|stg\./.test(host) ? 'staging' :
    'production';

  const IS_PROD = ENV === 'production';

  /* ==========================================================================
   * API endpoints
   * ======================================================================== */
  const RENDER_URL = 'https://cephasgm-ai.onrender.com';
  const LOCAL_URL  = 'http://localhost:6000';

  // checkAPI() tries these in order and sets window.API_BASE on first success.
  const API_URLS = isLocal
    ? [LOCAL_URL, RENDER_URL]
    : [RENDER_URL];

  /* ==========================================================================
   * Model catalog
   * ------------------------------------------------------------------------
   * Kept in sync with the <select id="modelSelect"> in index.html.
   *   id       — value sent to the server
   *   label    — shown in the UI
   *   provider — 'ollama' | 'openai' | 'deepseek' | 'local'
   *   tier     — 'free' | 'paid'
   *   task     — capabilities hint for the model router in ai.js
   * ======================================================================== */
  const MODEL_CATALOG = [
    // Free — local Ollama
    { id: 'ministral-3-3b',  label: 'Ministral 3 3B · fast',   provider: 'ollama', tier: 'free', task: ['chat', 'translate'] },
    { id: 'gemma-3-4b',      label: 'Gemma 3 4B',              provider: 'ollama', tier: 'free', task: ['chat'] },
    { id: 'ministral-3-8b',  label: 'Ministral 3 8B',          provider: 'ollama', tier: 'free', task: ['chat', 'analyze'] },
    { id: 'gemma-3-12b',     label: 'Gemma 3 12B',             provider: 'ollama', tier: 'free', task: ['chat', 'research'] },
    { id: 'ministral-3-14b', label: 'Ministral 3 14B',         provider: 'ollama', tier: 'free', task: ['code'] },

    // Paid — cloud
    { id: 'gpt-3.5-turbo',   label: 'OpenAI GPT-3.5',          provider: 'openai',   tier: 'paid', task: ['chat'] },
    { id: 'gpt-4',           label: 'OpenAI GPT-4',            provider: 'openai',   tier: 'paid', task: ['chat', 'research'] },
    { id: 'deepseek-chat',   label: 'DeepSeek',                provider: 'deepseek', tier: 'paid', task: ['code', 'research'] }
  ];

  // Legacy shape — kept so existing code (ai.js, agents.js) doesn't break.
  const MODELS = {
    CHAT:  MODEL_CATALOG.filter(m => m.task.includes('chat')).map(m => m.id),
    IMAGE: ['dall-e-2', 'dall-e-3', 'stable-diffusion'],
    AUDIO: ['whisper', 'tts-1'],
    VIDEO: ['gen-2', 'svd']
  };

  /* ==========================================================================
   * Feature flags — reviewed vs Phase roadmap
   * ======================================================================== */
  const FEATURES = {
    // Existing (kept)
    voiceInput:       true,
    imageGeneration:  true,
    videoGeneration:  true,
    codeExecution:    true,
    memory:           true,

    // New
    voiceTurnTaking:  true,    // Review #1 — state machine in voice.js
    memoryRecall:     true,    // Review #2 — auto-inject into prompts
    offlineInference: true,    // Review #3 — Ollama bridge when available
    stemTutor:        true,    // Review #4 — Tanzanian STEM killer app
    safetyAdvisor:    true,    // Review #4 — Industrial Safety killer app
    commercialApi:    !IS_PROD ? true : true,  // Review #5 — /v1/*
    pluginRegistry:   true,    // Review #5
    edgeLicensing:    true,    // Review #5
    swahili:          true,    // i18n — Phase 5
    usageMeter:       true     // /v1/usage
  };

  /* ==========================================================================
   * UI tunables
   * ======================================================================== */
  const UI = {
    maxChatHistory:  50,                    // legacy (kept)
    maxLocalMemory:  2000,                  // matches memory.js cap
    maxFileSize:     25 * 1024 * 1024,      // 25 MB — matches server CFG.maxUploadMB
    maxFilesPerMsg:  8,                     // matches server multer limit
    typingIndicator: true,
    autoSaveChat:    true,
    theme:           'dark',                // default; user override in localStorage
    sidebarDefault:  'open',
    streamTimeoutMs: 90_000
  };

  /* ==========================================================================
   * Offline / local inference
   * ======================================================================== */
  const OFFLINE = {
    enabled:         true,
    localURL:        LOCAL_URL,             // Ollama bridge (Phase 4)
    localModel:      'ministral-3-8b',
    queueOnFailure:  true,                  // client will queue unsent messages
    maxQueueSize:    20,
    fallbackMessage: 'You are offline. Messages will be queued and sent when you reconnect.'
  };

  /* ==========================================================================
   * Internationalization — EN + SW (Phase 5 prep)
   * ======================================================================== */
  const I18N = {
    default: 'en',
    locales: ['en', 'sw'],
    strings: {
      en: {
        appName:      'CephasGM SI',
        tagline:      'Superintelligence for Africa',
        newChat:      'New chat',
        listening:    'Listening…',
        processing:   'Processing…',
        speaking:     'Speaking…',
        offline:      'You are offline'
      },
      sw: {
        appName:      'CephasGM SI',
        tagline:      'Akili Kuu kwa Afrika',
        newChat:      'Mazungumzo mapya',
        listening:    'Inasikiliza…',
        processing:   'Inachakata…',
        speaking:     'Inazungumza…',
        offline:      'Huna mtandao'
      }
    }
  };

  /* ==========================================================================
   * Service worker / PWA
   * ======================================================================== */
  const SW = {
    enabled: true,
    path:    'sw.js',
    scope:   '/',
    // Updated at runtime by sw.js's SW_ACTIVATED message.
    version: null
  };

  /* ==========================================================================
   * Commercial layer (Review #5)
   * ------------------------------------------------------------------------
   * `testApiKey` is ONLY for local development against /v1/*.
   * NEVER put a real production key here — real keys are issued via Firestore
   * and stored by tenants. If you paste a real key, rotate it immediately.
   * ======================================================================== */
  const COMMERCIAL = {
    testApiKey: ENV === 'development' ? 'cgm_demo_key_1' : null,
    endpoints: {
      chat:    '/v1/chat',
      agents:  '/v1/agents',
      usage:   '/v1/usage',
      plugins: '/plugins',
      license: '/license/edge'
    },
    showUsageMeter: true
  };

  /* ==========================================================================
   * Monitoring (optional)
   * ======================================================================== */
  const TELEMETRY = {
    sentryDsn: null,   // set via <meta name="sentry-dsn"> if desired
    enableInDev: false,
    sampleRate: 0.1
  };

  /* ==========================================================================
   * Firebase
   * ------------------------------------------------------------------------
   * Keep this identical to the server's firebase-admin project.
   * ======================================================================== */
  const FIREBASE = {
    apiKey:            'AIzaSyAukJQx3pEqXoyFR9tyfeLckJaBIgYtGFA',
    authDomain:        'cephasgm-ai.firebaseapp.com',
    projectId:         'cephasgm-ai',
    storageBucket:     'cephasgm-ai.firebasestorage.app',
    messagingSenderId: '304163647028',
    appId:             '1:304163647028:web:2920b2cfb9be4049806461'
  };

  /* ==========================================================================
   * Assemble + freeze
   * ======================================================================== */
  const CONFIG = Object.freeze({
    // ── Legacy fields (unchanged names + shapes) ──────────────────────────
    API_URL: RENDER_URL,        // preferred URL; checkAPI() may override
    FIREBASE,
    MODELS,
    FEATURES,
    UI,
    DEBUG: !IS_PROD,

    // ── New fields ────────────────────────────────────────────────────────
    ENV,
    IS_PROD,
    API_URLS,
    LOCAL_URL,
    MODEL_CATALOG,
    OFFLINE,
    I18N,
    SW,
    COMMERCIAL,
    TELEMETRY,

    // ── Metadata ──────────────────────────────────────────────────────────
    VERSION: '6.0.0-si',
    BUILD:   'dev',   // overridden by sw.js at runtime
  });

  /* ==========================================================================
   * Attach to window
   * ======================================================================== */
  window.CEPHASGM_CONFIG = CONFIG;

  /* ==========================================================================
   * Debug log — safe, never prints secrets
   * ======================================================================== */
  if (!IS_PROD) {
    console.log('%cCephasGM SI', 'color:#f5b301;font-weight:700', 'config loaded', {
      env:        ENV,
      version:    CONFIG.VERSION,
      apiUrls:    API_URLS,
      featureCount: Object.values(FEATURES).filter(Boolean).length,
      modelCount: MODEL_CATALOG.length,
      ts:         new Date().toISOString()
    });
  }

  /* ==========================================================================
   * Helpers (safe to call from anywhere)
   * ======================================================================== */
  window.CEPHASGM_CONFIG.helpers = Object.freeze({
    /**
     * Look up a model's full metadata by id.
     */
    getModel(id) {
      return MODEL_CATALOG.find(m => m.id === id) || null;
    },

    /**
     * Returns true if `id` refers to a paid model.
     */
    isPaidModel(id) {
      const m = this.getModel(id);
      return !!(m && m.tier === 'paid');
    },

    /**
     * Translate a key using the active locale, falling back to EN.
     */
    t(key, locale) {
      const loc = locale || I18N.default;
      return I18N.strings[loc]?.[key] ?? I18N.strings.en[key] ?? key;
    },

    /**
     * Returns the list of feature flags that are ON.
     */
    activeFeatures() {
      return Object.entries(FEATURES).filter(([, v]) => v).map(([k]) => k);
    },

    /**
     * Whether we should show a "paid" badge for a model.
     */
    modelBadge(id) {
      const m = this.getModel(id);
      if (!m) return '';
      if (m.tier === 'paid') return 'Paid';
      if (m.provider === 'ollama') return 'Local';
      return '';
    }
  });

})();
