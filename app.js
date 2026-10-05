/**
 * CephasGM SI — app.js
 * ----------------------------------------------------------------------------
 * Compatibility + utility layer for the chat interface.
 *
 * Architecture note
 * -----------------
 * The new index.html bootstrap owns the canonical chat pipeline:
 *   - conversations[] / currentConversationId
 *   - sendMessage() / streamMessage() / clearChat()
 *   - addMessageAndSave() / _addMessageToChat() / showTypingIndicator()
 *   - localStorage schema: 'cephasgm_conversations' + 'currentConvId'
 *
 * This module's ONLY jobs are:
 *   1. Preserve the `window.ChatApp` namespace that legacy code imports.
 *   2. Delegate its methods to the canonical window.* functions.
 *   3. Migrate old `chatHistory` localStorage into the new schema (one-time).
 *   4. Provide small helpers (isReady, getCurrentConversation, exportChat).
 *
 * It must NOT bind DOM listeners, define a second sendMessage, or write to
 * localStorage under a different key — doing so caused double-sends and
 * split-brain persistence in the previous build.
 * ----------------------------------------------------------------------------
 */

window.ChatApp = window.ChatApp || (function () {
    'use strict';

    const MIGRATION_FLAG = 'cephasgm_app_js_migrated_v6';
    const LEGACY_KEY     = 'chatHistory';
    const NEW_KEY        = 'cephasgm_conversations';

    /* ======================================================================
     * Delegates — prefer canonical implementations on window
     * ==================================================================== */
    function sendMessage() {
        if (typeof window.streamMessage === 'function') return window.streamMessage();
        if (typeof window.sendMessage === 'function')   return window.sendMessage();
        console.warn('[ChatApp] No canonical sendMessage available');
    }

    function clearChat() {
        if (typeof window.clearChat === 'function') return window.clearChat();
        console.warn('[ChatApp] No canonical clearChat available');
    }

    /**
     * Legacy signature: addMessage(senderLabel, text).
     * Accepts 'You' / 'CephasGM AI' (old) or 'user' / 'ai' (new).
     * Delegates to window._addMessageToChat which handles markdown + sanitize.
     */
    function addMessage(sender, text) {
        const normalized = normalizeSender(sender);
        if (typeof window._addMessageToChat === 'function') {
            window._addMessageToChat(normalized, text, new Date().toISOString(), true);
            // Persist if a conversation is active
            if (typeof window.addMessageAndSave === 'function') {
                // addMessageAndSave re-renders; avoid double render by pushing directly
                const conv = getCurrentConversation();
                if (conv) {
                    conv.messages.push({
                        sender: normalized,
                        content: text,
                        timestamp: new Date().toISOString()
                    });
                    try {
                        localStorage.setItem(NEW_KEY, JSON.stringify(window.conversations || []));
                    } catch (e) { console.warn('[ChatApp] persist failed', e); }
                }
            }
            return;
        }
        console.warn('[ChatApp] No canonical addMessage renderer available');
    }

    function normalizeSender(sender) {
        if (!sender) return 'ai';
        const s = String(sender).toLowerCase();
        if (s === 'you' || s === 'user' || s === 'me') return 'user';
        return 'ai';
    }

    /* ======================================================================
     * Read-only utilities (safe for ai.js / agents.js / memory.js)
     * ==================================================================== */
    function isReady() {
        return typeof window.streamMessage === 'function'
            && Array.isArray(window.conversations);
    }

    function getCurrentConversation() {
        if (!Array.isArray(window.conversations)) return null;
        return window.conversations.find(c => c.id === window.currentConversationId) || null;
    }

    function getConversations() {
        return Array.isArray(window.conversations) ? window.conversations.slice() : [];
    }

    /**
     * Export the active conversation as JSON (or all, if all=true).
     * Used by future "Download chat" and by memory indexing.
     */
    function exportChat(all = false) {
        const payload = all ? getConversations() : (getCurrentConversation() || null);
        return JSON.stringify(payload, null, 2);
    }

    /**
     * Import a previously exported conversation object/array.
     * Merges without clobbering existing IDs.
     */
    function importChat(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;
            const incoming = Array.isArray(data) ? data : [data];
            const existingIds = new Set((window.conversations || []).map(c => String(c.id)));
            let added = 0;
            incoming.forEach(conv => {
                if (!conv || !Array.isArray(conv.messages)) return;
                if (existingIds.has(String(conv.id))) return;
                window.conversations.push({
                    id: conv.id || Date.now() + Math.floor(Math.random() * 1000),
                    title: conv.title || 'Imported chat',
                    messages: conv.messages,
                    createdAt: conv.createdAt || new Date().toISOString()
                });
                added++;
            });
            if (added) {
                localStorage.setItem(NEW_KEY, JSON.stringify(window.conversations));
                if (typeof window.loadConversations === 'function') window.loadConversations();
            }
            return added;
        } catch (e) {
            console.error('[ChatApp] importChat failed', e);
            return 0;
        }
    }

    /* ======================================================================
     * One-time migration from legacy 'chatHistory' → new schema
     * ==================================================================== */
    function migrateLegacyHistory() {
        if (localStorage.getItem(MIGRATION_FLAG)) return;

        let legacy = [];
        try {
            legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
        } catch {
            legacy = [];
        }

        if (Array.isArray(legacy) && legacy.length > 0) {
            let existing = [];
            try {
                existing = JSON.parse(localStorage.getItem(NEW_KEY) || '[]');
            } catch { existing = []; }

            // Only migrate if new store is empty, to avoid duplicating
            if (!Array.isArray(existing) || existing.length === 0) {
                const messages = legacy
                    .filter(m => m && (m.text || m.content))
                    .map(m => ({
                        sender: normalizeSender(m.sender),
                        content: m.text || m.content,
                        timestamp: m.timestamp || new Date().toISOString()
                    }));

                if (messages.length) {
                    const firstUser = messages.find(m => m.sender === 'user');
                    const title = firstUser
                        ? firstUser.content.slice(0, 42) + (firstUser.content.length > 42 ? '…' : '')
                        : 'Imported chat';

                    const migrated = [{
                        id: Date.now(),
                        title,
                        messages,
                        createdAt: new Date().toISOString()
                    }];

                    try {
                        localStorage.setItem(NEW_KEY, JSON.stringify(migrated));
                        localStorage.setItem('currentConvId', String(migrated[0].id));
                        console.info(`[ChatApp] Migrated ${messages.length} legacy messages.`);
                    } catch (e) {
                        console.warn('[ChatApp] migration write failed', e);
                    }
                }
            }
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
    }

    /* ======================================================================
     * init() — idempotent, safe to call multiple times
     * ==================================================================== */
    let initialized = false;
    function init() {
        if (initialized) return;
        initialized = true;

        migrateLegacyHistory();

        // If the canonical bootstrap hasn't rendered yet (e.g. async load order),
        // reload conversations so the migrated data appears.
        if (typeof window.loadConversations === 'function') {
            try { window.loadConversations(); } catch (e) { console.warn(e); }
        }
    }

    /* ======================================================================
     * Auto-init
     * ==================================================================== */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    /* ======================================================================
     * Public API — preserves legacy surface
     * ==================================================================== */
    return {
        // delegates
        sendMessage,
        addMessage,
        clearChat,

        // utilities
        init,
        isReady,
        getCurrentConversation,
        getConversations,
        exportChat,
        importChat,

        // exposed for tests / debugging
        _normalizeSender: normalizeSender,
        _migrateLegacyHistory: migrateLegacyHistory,
        version: '6.0.0-si'
    };
})();
