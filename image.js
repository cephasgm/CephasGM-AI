/**
 * CephasGM SI — image.js
 * ----------------------------------------------------------------------------
 * Real image generation client.
 *
 * - Multi-endpoint fallback (API_BASE → Render → cloud function)
 * - Retry with exponential backoff
 * - Abort + timeout
 * - Firebase ID token when available
 * - Saves successful generations to long-term memory
 * - Clean, non-clobbering busy UI
 * - Take-over after inline bootstrap (wins the global)
 * ----------------------------------------------------------------------------
 */

window.ImageModule = window.ImageModule || (function () {
    'use strict';

    /* ======================================================================
     * Config
     * ==================================================================== */
    const CFG = {
        renderURL: 'https://cephasgm-ai.onrender.com',
        cfURL:     'https://us-central1-cephasgm-ai.cloudfunctions.net/image',
        retry:     { tries: 3, baseMs: 300 },
        timeoutMs: 120_000  // image gen can be slow on cold start
    };

    /* ======================================================================
     * DOM
     * ==================================================================== */
    let promptEl, btnEl, resultEl, statusEl;
    let busy = false;
    let currentAbort = null;

    function bindDom() {
        promptEl = document.getElementById('imagePrompt');
        btnEl    = document.getElementById('generateImageBtn');
        resultEl = document.getElementById('imageResult');
        statusEl = document.getElementById('imageStatus');
    }

    /* ======================================================================
     * Endpoint list — follows checkAPI() fallback
     * ==================================================================== */
    function endpoints() {
        const base = (window.API_BASE || '').replace(/\/$/, '');
        const list = [];
        if (base) {
            list.push(`${base}/generate/image`);
            list.push(`${base}/api/generate/image`);
        }
        if (!base.startsWith(CFG.renderURL)) {
            list.push(`${CFG.renderURL}/generate/image`);
            list.push(`${CFG.renderURL}/api/generate/image`);
        }
        list.push(CFG.cfURL);
        // de-dup while preserving order
        return Array.from(new Set(list));
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
     * UI helpers
     * ==================================================================== */
    function setBusy(on) {
        busy = on;
        if (!btnEl) return;
        btnEl.disabled = on;
        btnEl.setAttribute('aria-busy', String(on));
        // Non-destructive: only toggle a class, never rewrite the label
        btnEl.classList.toggle('busy', on);
    }

    function showStatus(msg, type = 'info', autoClear = false) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.className = `status visible ${type}`;
        if (autoClear) {
            setTimeout(() => {
                if (statusEl.textContent === msg) {
                    statusEl.textContent = '';
                    statusEl.className = 'status';
                }
            }, 3000);
        }
    }

    function toast(msg) {
        if (typeof window.toast === 'function') window.toast(msg);
        else console.log('[Image]', msg);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
        );
    }

    /* ======================================================================
     * Networking
     * ==================================================================== */
    async function postJSON(url, body, signal) {
        const r = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify(body),
            mode: 'cors',
            signal
        });
        if (!r.ok) {
            const e = new Error(`HTTP ${r.status}`);
            e.status = r.status;
            try { e.detail = await r.json(); } catch {}
            throw e;
        }
        return r.json();
    }

    async function withRetry(fn, { tries = CFG.retry.tries, signal } = {}) {
        let lastErr;
        for (let i = 0; i < tries; i++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            try { return await fn(i); }
            catch (err) {
                lastErr = err;
                if (err?.name === 'AbortError') throw err;
                const s = err?.status || 0;
                if (s >= 400 && s < 500) throw err; // don't retry client errors
                if (i < tries - 1) await new Promise(r => setTimeout(r, CFG.retry.baseMs * Math.pow(2, i)));
            }
        }
        throw lastErr;
    }

    /* ======================================================================
     * Public: generateImage
     * ==================================================================== */
    async function generateImage(overridePrompt) {
        if (busy) return;

        const prompt = String(overridePrompt ?? promptEl?.value ?? '').trim();
        if (!prompt) {
            showStatus('Enter an image description', 'error');
            promptEl?.focus();
            return { success: false, error: 'empty-prompt' };
        }

        if (currentAbort) currentAbort.abort();
        const ctrl = new AbortController();
        currentAbort = ctrl;
        const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);

        setBusy(true);
        showStatus('Generating image…', 'info');
        if (resultEl) resultEl.innerHTML = '';

        try {
            const { url, endpoint } = await withRetry(async () => {
                let lastErr;
                for (const ep of endpoints()) {
                    try {
                        const data = await postJSON(ep, { prompt }, ctrl.signal);
                        const img = data.url || data.imageUrl || data.image_url || data.data?.[0]?.url;
                        if (!img) throw new Error('No image URL in response');
                        return { url: img, endpoint: ep };
                    } catch (e) {
                        lastErr = e;
                        if (e.name === 'AbortError') throw e;
                        if (e.status && e.status >= 400 && e.status < 500) throw e;
                    }
                }
                throw lastErr || new Error('All image endpoints failed');
            }, { signal: ctrl.signal });

            clearTimeout(timer);
            renderResult(url, prompt);
            showStatus('Image generated', 'success', true);
            toast('Image ready');

            // Persist to long-term memory (non-blocking)
            if (window.MemoryModule?.saveMemory) {
                window.MemoryModule.saveMemory(
                    `image:${prompt}`,
                    url,
                    { type: 'image', tags: ['image'], meta: { endpoint } }
                ).catch(() => {});
            }

            return { success: true, url, prompt, endpoint };
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                showStatus('Cancelled', 'info', true);
                return { success: false, error: 'aborted' };
            }
            const msg = err.message || 'Image generation failed';
            showStatus(msg, 'error');
            if (resultEl) {
                resultEl.innerHTML = `
                  <div style="text-align:center;padding:24px;color:var(--text-muted);">
                    <p style="font-size:15px;margin-bottom:6px;">Image generation failed</p>
                    <p style="font-size:12.5px;">${escapeHtml(msg)}</p>
                  </div>`;
            }
            return { success: false, error: msg };
        } finally {
            setBusy(false);
            if (currentAbort === ctrl) currentAbort = null;
        }
    }

    /* ======================================================================
     * Render
     * ==================================================================== */
    function renderResult(url, prompt) {
        if (!resultEl) return;
        resultEl.innerHTML = '';

        const img = document.createElement('img');
        img.src = url;
        img.alt = prompt;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.maxWidth = '100%';
        img.style.borderRadius = '10px';
        img.onerror = () => {
            showStatus('Image URL failed to load', 'error');
        };
        resultEl.appendChild(img);

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap;';

        const openBtn = document.createElement('button');
        openBtn.className = 'btn secondary';
        openBtn.type = 'button';
        openBtn.textContent = 'Open';
        openBtn.onclick = () => window.open(url, '_blank', 'noopener');

        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn secondary';
        dlBtn.type = 'button';
        dlBtn.textContent = 'Download';
        dlBtn.onclick = () => downloadImage(url, prompt);

        const regenBtn = document.createElement('button');
        regenBtn.className = 'btn';
        regenBtn.type = 'button';
        regenBtn.textContent = 'Regenerate';
        regenBtn.onclick = () => generateImage(prompt);

        actions.append(openBtn, dlBtn, regenBtn);
        resultEl.appendChild(actions);
    }

    /* ======================================================================
     * Download — revoke objectURL after the browser has consumed it
     * ==================================================================== */
    async function downloadImage(url, prompt) {
        try {
            const r = await fetch(url, { mode: 'cors' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const blob = await r.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            const safe = String(prompt).slice(0, 40).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
            a.download = `cephasgm-${safe || 'image'}-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Wait for the click to be processed before revoking
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
            toast('Download started');
        } catch (e) {
            console.warn('[Image] download failed', e);
            toast('Download failed — try Open instead');
        }
    }

    /* ======================================================================
     * Take-over from inline bootstrap
     * ----------------------------------------------------------------------
     * index.html inline script ends with `window.generateImage = generateImage`,
     * clobbering this module's export. We re-assert ours on next microtask
     * after load.
     * ==================================================================== */
    function takeOver() {
        bindDom();

        // Do NOT add another click listener — the HTML button already has
        // onclick="generateImage()", which resolves window.generateImage at
        // click time. We simply must ensure ours is the one on window.
        window.generateImage      = generateImage;
        window.ImageModule.generateImage = generateImage;

        // Optional enter-to-submit (idempotent)
        if (promptEl && promptEl.dataset.imageBound !== '1') {
            promptEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    generateImage();
                }
            });
            promptEl.dataset.imageBound = '1';
        }
    }

    function scheduleTakeOver() {
        if (document.readyState === 'complete') {
            setTimeout(takeOver, 0);
        } else {
            window.addEventListener('load', () => setTimeout(takeOver, 0), { once: true });
        }
    }
    scheduleTakeOver();

    /* ======================================================================
     * Public API
     * ==================================================================== */
    return {
        generateImage,
        downloadImage,

        // config / introspection
        endpoints,
        configure(patch) { Object.assign(CFG, patch); },

        // debug
        _isBusy: () => busy,
        _abort:  () => currentAbort?.abort(),

        version: '6.0.0-si'
    };
})();

/* ======================================================================
 * Global export (legacy callers)
 * ==================================================================== */
window.generateImage = window.ImageModule.generateImage;
