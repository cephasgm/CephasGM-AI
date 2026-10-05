/**
 * CephasGM SI — ai.js
 * ----------------------------------------------------------------------------
 * Real inference client for chat, agents, and research.
 *
 * Responsibilities:
 *   - Send prompts to the correct backend (Render / local Ollama / offline)
 *   - Stream real SSE deltas (no fake word-by-word replay)
 *   - Inject long-term memory (via MemoryModule.recall)
 *   - Route tasks → best model
 *   - Retry with exponential backoff
 *   - Forward Firebase ID token when present
 *   - Support cancellation via AbortController
 *
 * Not responsible for: rendering messages (that's index.html / app.js).
 * ----------------------------------------------------------------------------
 */

window.AIModule = window.AIModule || (function () {
    'use strict';

    /* ======================================================================
     * Config
     * ==================================================================== */
    const CFG = {
        renderURL:  'https://cephasgm-ai.onrender.com',
        localURL:   'http://localhost:6000',
        defaultModel: {
            chat:    'ministral-3-8b',
            code:    'ministral-3-14b',
            research:'gemma-3-12b',
            fast:    'ministral-3-3b'
        },
        retry: { tries: 3, baseMs: 200 },
        recallChars: 1000,
        recallTopK: 4,
        timeoutMs: 90_000
    };

    /* ======================================================================
     * Endpoint resolution — follows the same fallback as checkAPI()
     * ==================================================================== */
    function endpoints() {
        const live = (window.API_BASE || '').replace(/\/$/, '');
        const list = [];
        if (live) list.push(live);
        if (!list.includes(CFG.renderURL)) list.push(CFG.renderURL);
        if (!list.includes(CFG.localURL))  list.push(CFG.localURL);
        return list;
    }

    function currentMode() {
        const base = window.API_BASE || '';
        if (base.startsWith(CFG.renderURL)) return 'online';
        if (base.startsWith(CFG.localURL))  return 'local';
        return 'offline';
    }

    /* ======================================================================
     * Auth
     * ==================================================================== */
    async function authHeaders() {
        const h = { 'Content-Type': 'application/json' };
        try {
            const u = window.firebase?.auth?.().currentUser;
            if (u) h['Authorization'] = 'Bearer ' + await u.getIdToken();
        } catch {}
        return h;
    }

    /* ======================================================================
     * Model router — task hint → model id
     * ==================================================================== */
    function resolveModel(task = 'chat', explicit) {
        if (explicit) return explicit;
        const t = String(task).toLowerCase();
        if (/code|debug|refactor|program/.test(t))       return CFG.defaultModel.code;
        if (/research|analy[sz]e|investigate/.test(t))   return CFG.defaultModel.research;
        if (/translate|quick|short|summar/.test(t))      return CFG.defaultModel.fast;
        // Respect user's UI selection if a <select> exists
        const sel = document.getElementById('modelSelect');
        if (sel && sel.value) return sel.value;
        return CFG.defaultModel.chat;
    }

    /* ======================================================================
     * Memory recall injection
     * ==================================================================== */
    async function buildRecallContext(query) {
        if (!window.MemoryModule || typeof window.MemoryModule.recall !== 'function') return '';
        try {
            const block = await window.MemoryModule.recall(query, {
                limit: window.MemoryModule._index ? undefined : undefined
            });
            if (!block) return '';
            return block.length > CFG.recallChars
                ? block.slice(0, CFG.recallChars) + '…'
                : block;
        } catch (e) {
            console.warn('[AI] recall failed', e);
            return '';
        }
    }

    /* ======================================================================
     * Retry + backoff
     * ==================================================================== */
    async function withRetry(fn, { tries = CFG.retry.tries, signal } = {}) {
        let lastErr;
        for (let i = 0; i < tries; i++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
                return await fn(i);
            } catch (err) {
                lastErr = err;
                // Don't retry these
                if (err?.name === 'AbortError') throw err;
                const status = err?.status || 0;
                if (status === 400 || status === 401 || status === 403 || status === 404) throw err;
                if (i < tries - 1) {
                    const delay = CFG.retry.baseMs * Math.pow(2, i);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastErr;
    }

    /* ======================================================================
     * HTTP helpers
     * ==================================================================== */
    async function postJSON(url, body, signal) {
        const r = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify(body),
            signal
        });
        if (!r.ok) {
            const err = new Error(`HTTP ${r.status}`);
            err.status = r.status;
            try { err.detail = await r.json(); } catch {}
            throw err;
        }
        return r.json();
    }

    /**
     * Real SSE streaming. Expects OpenAI-style `data: {json}\n\n` frames,
     * with `[DONE]` terminator. Returns the concatenated text.
     */
    async function postStream(url, body, { onDelta, signal }) {
        const r = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify(body),
            signal
        });
        if (!r.ok) {
            const err = new Error(`HTTP ${r.status}`);
            err.status = r.status;
            throw err;
        }
        if (!r.body) throw new Error('Streaming unsupported by server');

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === '[DONE]') continue;
                let parsed;
                try { parsed = JSON.parse(payload); }
                catch { continue; }

                const delta =
                    parsed.choices?.[0]?.delta?.content ??
                    parsed.choices?.[0]?.message?.content ??
                    parsed.delta ??
                    parsed.content ??
                    '';
                if (delta) {
                    full += delta;
                    if (onDelta) onDelta(delta, full);
                }
            }
        }
        return full;
    }

    /* ======================================================================
     * Public: askAI (non-streaming)
     * ==================================================================== */
    async function askAI(message, history = [], opts = {}) {
        if (!message || !String(message).trim()) {
            return { success: false, error: 'Message is required', content: 'Please enter a message.' };
        }
        const model = resolveModel(opts.task || 'chat', opts.model);
        const recall = opts.useMemory === false ? '' : await buildRecallContext(message);

        const payload = {
            prompt: message,
            model,
            history: Array.isArray(history) ? history.slice(-20) : [],
            context: recall || undefined,
            options: opts.options || {}
        };

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CFG.timeoutMs);
        const signal = opts.signal || controller.signal;

        try {
            const result = await withRetry(async () => {
                let lastErr;
                for (const base of endpoints()) {
                    try {
                        const data = await postJSON(`${base}/chat`, payload, signal);
                        return { base, data };
                    } catch (e) {
                        lastErr = e;
                        if (e.status && e.status >= 400 && e.status < 500) throw e;
                    }
                }
                throw lastErr || new Error('No endpoint reachable');
            }, { signal });

            clearTimeout(timer);

            // Normalize response shape
            const d = result.data || {};
            return {
                success: true,
                content: d.content || d.response || d.text || d.message || 'No response',
                model:   d.model || model,
                usage:   d.usage || null,
                base:    result.base,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            clearTimeout(timer);
            return {
                success: false,
                error: error.name === 'AbortError' ? 'cancelled' : 'AI service unavailable',
                content: error.name === 'AbortError'
                    ? 'Request cancelled.'
                    : "I'm having trouble connecting. Please try again.",
                details: error.message,
                status: error.status
            };
        }
    }

    /* ======================================================================
     * Public: askAIStream (real SSE)
     * ==================================================================== */
    async function askAIStream(message, onDelta, onComplete, history = [], opts = {}) {
        // Backward-compat: older signature had (message, onChunk, onComplete, history)
        // Our new one keeps the same arg order but treats onDelta as real deltas.
        const model = resolveModel(opts.task || 'chat', opts.model);
        const recall = opts.useMemory === false ? '' : await buildRecallContext(message);

        const payload = {
            prompt: message,
            model,
            history: Array.isArray(history) ? history.slice(-20) : [],
            context: recall || undefined,
            options: opts.options || {},
            stream: true
        };

        const controller = new AbortController();
        const signal = opts.signal || controller.signal;
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CFG.timeoutMs);

        try {
            let full = '';
            let usedBase = null;

            for (const base of endpoints()) {
                try {
                    full = await postStream(`${base}/chat/stream`, payload, {
                        signal,
                        onDelta: (delta, sofar) => {
                            if (onDelta) onDelta(delta, sofar);
                        }
                    });
                    usedBase = base;
                    break;
                } catch (e) {
                    if (e.name === 'AbortError') throw e;
                    if (e.status && e.status === 404) {
                        // Server doesn't expose /chat/stream — fall back to full response
                        const res = await postJSON(`${base}/chat`, { ...payload, stream: false }, signal);
                        full = res.content || res.response || res.text || '';
                        if (onDelta && full) onDelta(full, full);
                        usedBase = base;
                        break;
                    }
                    // Try next endpoint
                }
            }

            if (usedBase == null) throw new Error('No streaming endpoint reachable');

            clearTimeout(timer);
            if (onComplete) onComplete(full);
            return { success: true, content: full, model, base: usedBase };

        } catch (error) {
            clearTimeout(timer);
            const msg = error.name === 'AbortError'
                ? 'Request cancelled.'
                : 'Service unavailable. Please try again.';
            if (onDelta) onDelta(msg, msg);
            if (onComplete) onComplete('');
            return { success: false, error: error.name, content: msg, details: error.message };
        }
    }

    /* ======================================================================
     * Public: helpers
     * ==================================================================== */
    function abortable() {
        const c = new AbortController();
        return { signal: c.signal, abort: () => c.abort() };
    }

    function isOnline() { return currentMode() !== 'offline'; }
    function mode()     { return currentMode(); }

    function configure(patch = {}) {
        Object.assign(CFG, patch);
    }

    /* ======================================================================
     * Public API
     * ==================================================================== */
    return {
        askAI,
        askAIStream,
        resolveModel,
        buildRecallContext,
        abortable,
        isOnline,
        mode,
        configure,
        version: '6.0.0-si'
    };
})();

/* ======================================================================
 * Globals for legacy callers
 * ==================================================================== */
window.askAI       = window.AIModule.askAI;
window.askAIStream = window.AIModule.askAIStream;
