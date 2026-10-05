/**
 * CephasGM SI — memory.js
 * ----------------------------------------------------------------------------
 * Three-tier long-term memory for agents and chat.
 *
 *   Tier 1: local vector index (always works, offline-first)
 *   Tier 2: Firebase Firestore mirror (cross-device, per-user)
 *   Tier 3: pluggable vector backend (Pinecone / Weaviate via CF)
 *
 * Provides:
 *   - saveMemory(prompt, response, meta)   → persists across all tiers
 *   - searchMemories(query, opts)          → cosine-ranked recall
 *   - recall(query, opts)                  → prompt-ready string block
 *   - getRecentMemories(n)
 *   - setUserId(uid)                       → called by auth
 *   - ingestExchange(user, ai, meta)       → called by chat auto-hook
 *   - clearLocalMemory()
 *   - setEmbedder(fn)                      → Phase 3.5 upgrade hook
 *   - setVectorBackend({...})              → Phase 3.5 upgrade hook
 *
 * Memory types: 'conversation' | 'preference' | 'fact' | 'document'
 * ----------------------------------------------------------------------------
 */

window.MemoryModule = window.MemoryModule || (function () {
    'use strict';

    /* ======================================================================
     * Config
     * ==================================================================== */
    const CFG = {
        localKey:      'cephasgm_memory_local_v1',
        userKey:       'cephasgm_memory_uid',
        sessionKey:    'cephasgm_session',
        maxLocal:      2000,      // hard cap on local index size
        pruneTo:       1500,      // prune down to this when cap exceeded
        searchLimit:   5,
        minScore:      0.15,      // cosine similarity floor
        recallMaxChars:1200,      // cap on prompt-injected context
        embedDim:      128,
        vectorEndpoint:'https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory',
        autoIngest:    true       // MutationObserver on #chat
    };

    /* ======================================================================
     * State
     * ==================================================================== */
    let db = null;                    // Firestore (compat)
    let userId = null;                // Auth uid — falls back to sessionId
    let embedder = defaultEmbedder;   // pluggable
    let vectorBackend = null;         // pluggable; if null, local-only
    let index = loadLocalIndex();     // in-memory array of records

    /* ======================================================================
     * Utilities
     * ==================================================================== */
    function uid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    function sessionId() {
        let sid = localStorage.getItem(CFG.sessionKey);
        if (!sid) {
            sid = 'session_' + uid();
            localStorage.setItem(CFG.sessionKey, sid);
        }
        return sid;
    }

    function currentScope() {
        return userId || sessionId();
    }

    function hash(str) {
        // FNV-1a 32-bit
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return h >>> 0;
    }

    function dedupeKey(prompt, response) {
        return hash(String(prompt).slice(0, 400) + '||' + String(response).slice(0, 400));
    }

    /* ======================================================================
     * Default embedder — feature hashing (real ML technique, no API key)
     * ----------------------------------------------------------------------
     * Produces a deterministic 128-dim normalized vector from text.
     * Quality is lower than neural embeddings but functional, offline-safe,
     * and swappable via setEmbedder() in Phase 3.5.
     * ==================================================================== */
    const STOPWORDS = new Set(
        'a an and or but if then the of to in on at for with by from as is are was were be been being this that these those it its'.split(' ')
    );

    function defaultEmbedder(text) {
        const vec = new Float32Array(CFG.embedDim);
        const tokens = String(text || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1 && !STOPWORDS.has(t));

        for (const tok of tokens) {
            // Unigram
            const h1 = hash(tok);
            vec[h1 % CFG.embedDim] += (h1 & 0x80000000) ? -1 : 1;
            // Char trigrams — captures morphology (e.g. "run/runner")
            for (let i = 0; i < tok.length - 2; i++) {
                const tri = tok.slice(i, i + 3);
                const h2 = hash(tri);
                vec[h2 % CFG.embedDim] += ((h2 >>> 31) ? -1 : 1) * 0.35;
            }
        }
        // L2 normalize
        let norm = 0;
        for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < vec.length; i++) vec[i] /= norm;
        return Array.from(vec);
    }

    function cosine(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const d = Math.sqrt(na) * Math.sqrt(nb);
        return d ? dot / d : 0;
    }

    /* ======================================================================
     * Tier 1 — local index (localStorage)
     * ==================================================================== */
    function loadLocalIndex() {
        try {
            const raw = localStorage.getItem(CFG.localKey);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function persistLocalIndex() {
        try {
            if (index.length > CFG.maxLocal) {
                // keep most recent N
                index.sort((a, b) => b.timestamp - a.timestamp);
                index = index.slice(0, CFG.pruneTo);
            }
            localStorage.setItem(CFG.localKey, JSON.stringify(index));
        } catch (e) {
            console.warn('[Memory] local persist failed', e);
        }
    }

    function localUpsert(record) {
        const i = index.findIndex(r => r.id === record.id);
        if (i >= 0) index[i] = record;
        else index.push(record);
        persistLocalIndex();
    }

    function localSearch(queryVec, { limit, type, scope }) {
        const results = [];
        for (const rec of index) {
            if (type && rec.type !== type) continue;
            if (scope && rec.scope !== scope) continue;
            const score = cosine(queryVec, rec.vec);
            if (score >= CFG.minScore) results.push({ ...rec, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    /* ======================================================================
     * Tier 2 — Firestore mirror (compat, already loaded by index.html)
     * ==================================================================== */
    async function ensureFirestore() {
        if (db) return db;
        if (!window.firebase || !firebase.firestore) return null;
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(window.CEPHASGM_CONFIG?.FIREBASE || {});
            }
            db = firebase.firestore();
            return db;
        } catch (e) {
            console.warn('[Memory] Firestore init failed', e);
            return null;
        }
    }

    async function firestoreWrite(record) {
        const store = await ensureFirestore();
        if (!store) return null;
        try {
            const path = `memory/${record.scope}/items`;
            const ref = await store.collection(path).add({
                prompt:    record.prompt,
                response:  record.response,
                type:      record.type,
                tags:      record.tags || [],
                hash:      record.hash,
                timestamp: record.timestamp,
                userId:    userId || null,
                sessionId: sessionId()
            });
            return ref.id;
        } catch (e) {
            console.warn('[Memory] Firestore write failed', e);
            return null;
        }
    }

    async function firestoreFetchRecent(count, scope) {
        const store = await ensureFirestore();
        if (!store) return [];
        try {
            const snap = await store.collection(`memory/${scope}/items`)
                .orderBy('timestamp', 'desc')
                .limit(count)
                .get();
            const out = [];
            snap.forEach(d => out.push({ id: d.id, ...d.data() }));
            return out;
        } catch (e) {
            console.warn('[Memory] Firestore fetch failed', e);
            return [];
        }
    }

    /* ======================================================================
     * Tier 3 — vector backend adapter (Pinecone / Weaviate) — Phase 3.5
     * ==================================================================== */
    async function vectorUpsert(record) {
        if (vectorBackend && typeof vectorBackend.upsert === 'function') {
            try { return await vectorBackend.upsert(record); }
            catch (e) { console.warn('[Memory] vectorUpsert failed', e); }
        }
        // Fallback bridge: our Cloud Function accepts add/search actions.
        if (!CFG.vectorEndpoint) return null;
        try {
            const r = await fetch(CFG.vectorEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'add',
                    id: record.id,
                    text: `${record.prompt}\n${record.response}`,
                    metadata: {
                        type: record.type,
                        tags: record.tags || [],
                        scope: record.scope,
                        timestamp: record.timestamp
                    }
                })
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json().catch(() => ({}));
        } catch (e) {
            // Silent here — Tier 3 is optional; log at debug
            return null;
        }
    }

    async function vectorSearch(query, opts) {
        if (vectorBackend && typeof vectorBackend.search === 'function') {
            try { return await vectorBackend.search(query, opts); }
            catch (e) { console.warn('[Memory] vectorSearch failed', e); }
        }
        if (!CFG.vectorEndpoint) return [];
        try {
            const r = await fetch(CFG.vectorEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'search',
                    text: query,
                    limit: opts.limit,
                    threshold: opts.minScore,
                    filter: { scope: opts.scope, type: opts.type || null }
                })
            });
            if (!r.ok) return [];
            const data = await r.json();
            return Array.isArray(data.results) ? data.results : [];
        } catch {
            return [];
        }
    }

    /* ======================================================================
     * Public: write
     * ==================================================================== */
    async function saveMemory(prompt, response, meta = {}) {
        if (!prompt && !response) return { error: 'Nothing to save' };

        const scope = meta.scope || currentScope();
        const text  = `${prompt || ''}\n${response || ''}`.trim();
        const vec   = embedder(text);
        const id    = uid();
        const now   = Date.now();
        const hashKey = dedupeKey(prompt, response);

        // Dedupe: if the same (prompt, response) already exists in scope, skip.
        const dup = index.find(r => r.hash === hashKey && r.scope === scope);
        if (dup) {
            dup.timestamp = now; // touch — helps recency ranking
            persistLocalIndex();
            return { success: true, id: dup.id, deduped: true };
        }

        const record = {
            id,
            scope,
            type: meta.type || 'conversation',
            tags: meta.tags || [],
            prompt: prompt || '',
            response: response || '',
            vec,
            hash: hashKey,
            timestamp: now
        };

        localUpsert(record);

        // Fire-and-forget mirror writes
        Promise.allSettled([
            firestoreWrite(record),
            vectorUpsert(record)
        ]);

        return { success: true, id };
    }

    /**
     * Called by the chat auto-hook with the last user+ai exchange.
     */
    async function ingestExchange(userText, aiText, meta = {}) {
        if (!userText && !aiText) return;
        return saveMemory(userText, aiText, { type: 'conversation', ...meta });
    }

    /**
     * Save a preference — used by settings, agents, onboarding.
     */
    async function savePreference(key, value, meta = {}) {
        return saveMemory(`preference:${key}`, JSON.stringify(value), {
            type: 'preference',
            tags: [key],
            ...meta
        });
    }

    /* ======================================================================
     * Public: read
     * ==================================================================== */
    async function searchMemories(query, opts = {}) {
        const cfg = {
            limit:    opts.limit    ?? CFG.searchLimit,
            minScore: opts.minScore ?? CFG.minScore,
            type:     opts.type     || null,
            scope:    opts.scope    || currentScope()
        };
        const queryVec = embedder(query);

        // Local first — fast, always works
        const local = localSearch(queryVec, cfg);

        // Firestore recent (for cross-device recall when local is thin)
        if (local.length < cfg.limit) {
            const recent = await firestoreFetchRecent(cfg.limit * 4, cfg.scope);
            const recentIds = new Set(local.map(r => r.id));
            for (const rec of recent) {
                if (recentIds.has(rec.id)) continue;
                if (cfg.type && rec.type !== cfg.type) continue;
                // Firestore doesn't store vec — recompute
                const text = `${rec.prompt || ''}\n${rec.response || ''}`;
                const recVec = embedder(text);
                const score = cosine(queryVec, recVec);
                if (score >= cfg.minScore) {
                    local.push({
                        id: rec.id,
                        scope: cfg.scope,
                        type: rec.type || 'conversation',
                        prompt: rec.prompt || '',
                        response: rec.response || '',
                        tags: rec.tags || [],
                        timestamp: rec.timestamp || 0,
                        score
                    });
                }
            }
        }

        // Tier 3 vector backend — best quality if available
        const vec = await vectorSearch(query, cfg);
        const seenIds = new Set(local.map(r => r.id));
        for (const r of vec) {
            if (r.id && !seenIds.has(r.id)) {
                local.push({
                    id: r.id,
                    scope: cfg.scope,
                    type: r.metadata?.type || 'conversation',
                    prompt: r.metadata?.prompt || '',
                    response: r.metadata?.response || '',
                    tags: r.metadata?.tags || [],
                    timestamp: r.metadata?.timestamp || 0,
                    score: r.score ?? 0
                });
            }
        }

        local.sort((a, b) => b.score - a.score);
        return local.slice(0, cfg.limit);
    }

    async function getRecentMemories(count = 10) {
        const scope = currentScope();
        const recent = await firestoreFetchRecent(count, scope);
        if (recent.length) return recent;
        // Offline fallback: from local index
        return index
            .filter(r => r.scope === scope)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }

    /**
     * recall(query) — returns a prompt-ready string block for agents.
     * Phase 5 will prepend this to system prompts.
     */
    async function recall(query, opts = {}) {
        const mems = await searchMemories(query, opts);
        if (!mems.length) return '';
        let block = 'Relevant long-term memory:\n';
        let budget = CFG.recallMaxChars - block.length;
        for (const m of mems) {
            const line = `- Q: ${m.prompt}\n  A: ${(m.response || '').slice(0, 220)}\n`;
            if (line.length > budget) break;
            block += line;
            budget -= line.length;
        }
        return block;
    }

    /* ======================================================================
     * Public: lifecycle / config
     * ==================================================================== */
    function setUserId(uid) {
        const prev = userId;
        userId = uid || null;
        if (prev === userId) return;
        localStorage.setItem(CFG.userKey, userId || '');
        // Re-scope: any 'anonymous' memories from this session become this user's
        const sid = sessionId();
        let moved = 0;
        for (const r of index) {
            if (r.scope === sid) { r.scope = currentScope(); moved++; }
        }
        if (moved) persistLocalIndex();
        console.info(`[Memory] scope=${currentScope()} (${moved} memories rescoped)`);
    }

    function getUserId() { return userId; }

    function setEmbedder(fn) {
        if (typeof fn !== 'function') return;
        embedder = fn;
        // Re-embed local index in background
        index.forEach(r => {
            r.vec = embedder(`${r.prompt}\n${r.response}`);
        });
        persistLocalIndex();
    }

    function setVectorBackend(backend) {
        if (!backend || typeof backend !== 'object') return;
        vectorBackend = backend;
    }

    function clearLocalMemory() {
        if (!confirm('Clear all local memory? This does not delete cloud memories.')) return;
        index = [];
        localStorage.removeItem(CFG.localKey);
        if (window.toast) window.toast('Local memory cleared');
        else console.info('[Memory] local cleared');
    }

    /* ======================================================================
     * Chat auto-hook (MutationObserver on #chat)
     * ----------------------------------------------------------------------
     * Detects a completed AI message (800ms of no further mutations), pairs
     * it with the most recent user message, and ingests the exchange.
     * ==================================================================== */
    let observer = null;
    let lastUserText = '';
    const pending = new WeakMap(); // aiElement -> timeoutId

    function hookChat() {
        const chat = document.getElementById('chat');
        if (!chat || !CFG.autoIngest) return;
        if (observer) observer.disconnect();

        observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (!node.classList.contains('message')) continue;

                    if (node.classList.contains('user-message')) {
                        const c = node.querySelector('.msg-content');
                        lastUserText = (c?.innerText || '').trim();
                    } else if (node.classList.contains('ai-message')) {
                        // Debounce: wait for streaming to finish
                        clearTimeout(pending.get(node));
                        const t = setTimeout(() => {
                            const c = node.querySelector('.msg-content');
                            const aiText = (c?.innerText || '').trim();
                            if (aiText && !/^(Error:|Working…)/.test(aiText)) {
                                ingestExchange(lastUserText, aiText).catch(() => {});
                                lastUserText = '';
                            }
                        }, 800);
                        pending.set(node, t);
                    }
                }
            }
        });

        observer.observe(chat, { childList: true, subtree: false });
    }

    /* ======================================================================
     * Firebase auth wiring (uses whichever SDK is on window.firebase)
     * ==================================================================== */
    function hookAuth() {
        if (!window.firebase || !firebase.auth) return;
        try {
            firebase.auth().onAuthStateChanged(user => {
                setUserId(user ? user.uid : null);
            });
        } catch (e) {
            console.warn('[Memory] auth hook failed', e);
        }
    }

    /* ======================================================================
     * Boot
     * ==================================================================== */
    function boot() {
        ensureFirestore();
        hookAuth();
        hookChat();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    /* ======================================================================
     * Public API
     * ==================================================================== */
    return {
        // write
        saveMemory,
        savePreference,
        ingestExchange,

        // read
        searchMemories,
        getRecentMemories,
        recall,

        // lifecycle
        setUserId,
        getUserId,
        clearLocalMemory,

        // upgrade hooks (Phase 3.5)
        setEmbedder,
        setVectorBackend,

        // debug
        _index: () => index,
        _scope: currentScope,
        _embed: (t) => embedder(t),

        version: '6.0.0-si'
    };
})();

/* ======================================================================
 * Globals expected by legacy code
 * ==================================================================== */
window.saveMemory        = window.MemoryModule.saveMemory;
window.searchMemories    = window.MemoryModule.searchMemories;
window.getRecentMemories = window.MemoryModule.getRecentMemories;
window.clearLocalMemory  = window.MemoryModule.clearLocalMemory;
