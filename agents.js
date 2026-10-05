/**
 * CephasGM SI — agents.js
 * ----------------------------------------------------------------------------
 * Plugin-style agent registry + executor.
 *
 * Third parties add agents via:
 *     AgentsModule.register({
 *         id: 'weather',
 *         name: 'Weather',
 *         icon: '🌤️',
 *         description: 'Current weather for any city',
 *         category: 'tool',
 *         run: async (input, ctx) => ({ content: '...' })
 *     });
 *
 * Built-in agents:
 *     search · summarize · translate · analyze · code · research
 *     tutor   ← killer app #1 (Tanzanian STEM)
 *     safety  ← killer app #2 (Industrial Safety Advisor)
 *
 * Uses:
 *     AIModule.askAI        — real inference (retry, auth, memory recall)
 *     MemoryModule.recall   — long-term memory injection
 *     MemoryModule.saveMemory — persist agent outcomes
 * ----------------------------------------------------------------------------
 */

window.AgentsModule = window.AgentsModule || (function () {
    'use strict';

    /* ======================================================================
     * Registry
     * ==================================================================== */
    const registry = new Map();

    function register(agent) {
        if (!agent || !agent.id || typeof agent.run !== 'function') {
            console.warn('[Agents] register() requires { id, run }');
            return false;
        }
        registry.set(agent.id, {
            id:          agent.id,
            name:        agent.name || agent.id,
            icon:        agent.icon || '🤖',
            description: agent.description || '',
            category:    agent.category || 'general',
            premium:     !!agent.premium,
            hidden:      !!agent.hidden,
            run:         agent.run
        });
        return true;
    }

    function unregister(id) { return registry.delete(id); }
    function get(id)        { return registry.get(id) || null; }
    function list(opts = {}) {
        const all = Array.from(registry.values());
        return opts.includeHidden ? all : all.filter(a => !a.hidden);
    }

    /* ======================================================================
     * Executor
     * ----------------------------------------------------------------------
     * Accepts BOTH signatures:
     *   runAgent(task, type)                     — legacy
     *   runAgent({ task, agentType }, fallback)  — new
     * ==================================================================== */
    async function runAgent(taskOrOpts, typeOrFallback = 'auto') {
        let task, type;

        if (taskOrOpts && typeof taskOrOpts === 'object') {
            task = taskOrOpts.task || taskOrOpts.prompt || '';
            type = taskOrOpts.agentType || taskOrOpts.type || typeOrFallback;
        } else {
            task = taskOrOpts || '';
            type = typeOrFallback;
        }

        if (!task || !String(task).trim()) {
            return { success: false, error: 'Task is required', content: 'Please provide a task.' };
        }

        const agent = registry.get(type) || registry.get('chat');
        if (!agent) {
            return { success: false, error: `Unknown agent: ${type}`, content: `No agent registered for "${type}".` };
        }

        const ctx = {
            task: String(task),
            agentId: agent.id,
            signal: undefined,
            meta: {}
        };

        const t0 = performance.now();
        try {
            const result = await agent.run(ctx.task, ctx);
            const dt = (performance.now() - t0).toFixed(0);

            const normalized = {
                success: true,
                agentId: agent.id,
                type: agent.id,
                content: extractContent(result),
                raw: result,
                elapsedMs: Number(dt),
                timestamp: new Date().toISOString()
            };

            // Persist outcome to memory (non-blocking)
            if (window.MemoryModule && agent.category !== 'tool') {
                window.MemoryModule.saveMemory(
                    `[${agent.id}] ${ctx.task}`,
                    normalized.content,
                    { type: 'agent', tags: [agent.id] }
                ).catch(() => {});
            }

            return normalized;
        } catch (err) {
            if (err?.name === 'AbortError') {
                return { success: false, error: 'cancelled', content: 'Cancelled.' };
            }
            console.error(`[Agents] ${agent.id} failed:`, err);
            return {
                success: false,
                agentId: agent.id,
                error: err.message || 'Agent failed',
                content: `The ${agent.name} agent could not complete the task.`,
                details: err.message
            };
        }
    }

    function extractContent(r) {
        if (r == null) return '';
        if (typeof r === 'string') return r;
        if (r.content) return r.content;
        if (r.output) return r.output;
        if (r.summary) return r.summary;
        if (r.text) return r.text;
        if (r.response) return r.response;
        return JSON.stringify(r, null, 2);
    }

    /* ======================================================================
     * Inference helper — every agent funnels through here
     * ==================================================================== */
    async function infer(prompt, { task = 'chat', model, system, useMemory = true } = {}) {
        if (!window.AIModule) throw new Error('AIModule unavailable');
        const composed = system
            ? `${system}\n\n---\n\n${prompt}`
            : prompt;
        const res = await window.AIModule.askAI(composed, [], {
            task,
            model,
            useMemory
        });
        if (!res.success) throw new Error(res.details || res.error || 'Inference failed');
        return res.content;
    }

    /* ======================================================================
     * Built-in agents
     * ==================================================================== */

    register({
        id: 'chat',
        name: 'Chat',
        icon: '💬',
        description: 'General conversation',
        category: 'core',
        hidden: true,
        run: async (task) => infer(task, { task: 'chat' })
    });

    register({
        id: 'search',
        name: 'Search',
        icon: '🔍',
        description: 'Look up information on the web',
        category: 'tool',
        run: async (task) => {
            // Search has no local model. Route to research endpoint if available.
            const base = (window.API_BASE || '').replace(/\/$/, '');
            if (!base) throw new Error('Offline — search unavailable');
            const r = await fetch(`${base}/research`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: task, depth: 'basic' })
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            return { content: data.summary || data.result || data.content || 'No results' };
        }
    });

    register({
        id: 'summarize',
        name: 'Summarize',
        icon: '📝',
        description: 'Condense long text into key points',
        category: 'writing',
        run: async (task) => infer(
            `Summarize the following text in 3–5 concise bullet points:\n\n${task}`,
            { task: 'summarize', system: 'You are a precise summarizer. Reply with bullets only.' }
        )
    });

    register({
        id: 'translate',
        name: 'Translate',
        icon: '🌍',
        description: 'Translate between languages',
        category: 'writing',
        run: async (task) => infer(
            `Translate the following to the target language. If unclear, translate to Swahili.\n\n${task}`,
            { task: 'translate', system: 'You are a professional translator. Preserve tone.' }
        )
    });

    register({
        id: 'analyze',
        name: 'Analyze',
        icon: '📊',
        description: 'Data & sentiment analysis',
        category: 'analysis',
        run: async (task) => infer(
            `Analyze the following and provide: (1) summary, (2) key findings as bullets, (3) one recommendation.\n\n${task}`,
            { task: 'analyze' }
        )
    });

    register({
        id: 'code',
        name: 'Coding',
        icon: '💻',
        description: 'Write, explain, and debug code',
        category: 'code',
        run: async (task) => infer(
            `Task: ${task}\n\nRespond with the code in a fenced block, then a brief explanation, then any test cases.`,
            { task: 'code', system: 'You are a senior software engineer. Prefer correct, minimal, idiomatic code.' }
        )
    });

    register({
        id: 'research',
        name: 'Research',
        icon: '🔬',
        description: 'Deep, multi-source research',
        category: 'analysis',
        run: async (task) => {
            const base = (window.API_BASE || '').replace(/\/$/, '');
            if (!base) throw new Error('Offline — research unavailable');
            const r = await fetch(`${base}/task`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task: `research ${task}`, options: { agentType: 'research', depth: 'deep' } })
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const res = data.result || data;
            if (res.summary) return { content: res.summary, raw: res };
            return { content: extractContent(res), raw: res };
        }
    });

    /* ======================================================================
     * KILLER APP #1 — Tanzanian STEM Tutor (Review #5)
     * ----------------------------------------------------------------------
     * Memory-backed, curriculum-aware, bilingual (EN/SW), exam-focused.
     * ==================================================================== */
    register({
        id: 'tutor',
        name: 'STEM Tutor',
        icon: '🎓',
        description: 'Tanzanian secondary STEM — maths, physics, chemistry, biology',
        category: 'education',
        run: async (task, ctx) => {
            // Pull learner preferences + prior misconceptions from memory
            let learnerContext = '';
            if (window.MemoryModule) {
                try {
                    const prefs = await window.MemoryModule.searchMemories(
                        `preference:learner ${task}`,
                        { type: 'preference', limit: 3 }
                    );
                    const prior = await window.MemoryModule.searchMemories(task, {
                        type: 'agent', limit: 4
                    });
                    const bits = [
                        ...prefs.map(p => `- ${p.prompt}: ${p.response}`),
                        ...prior.map(p => `- previously discussed: ${p.prompt}`)
                    ];
                    if (bits.length) learnerContext = `\n\nKnown learner context:\n${bits.join('\n')}`;
                } catch {}
            }

            const system =
`You are the CephasGM SI STEM Tutor for Tanzanian secondary students (Form 1–6, NECTA syllabus).
Rules:
- Diagnose the learner's current understanding before assuming knowledge.
- Explain step-by-step. Show every algebraic step for maths.
- Use everyday Tanzanian examples (daladala, shilling, Lake Victoria, Kilimanjaro) where helpful.
- After explaining, give ONE practice question and wait for the answer before continuing.
- If the learner writes in Swahili, respond in Swahili; otherwise use simple English.
- Never invent formulas. If unsure, say so.${learnerContext}`;

            const content = await infer(task, {
                task: 'chat',
                system,
                useMemory: true
            });

            // Save as a preference signal so future sessions personalize
            if (window.MemoryModule) {
                window.MemoryModule.saveMemory(
                    `preference:learner:${task.slice(0, 60)}`,
                    JSON.stringify({ lastTopic: task.slice(0, 120) }),
                    { type: 'preference', tags: ['tutor'] }
                ).catch(() => {});
            }

            return { content };
        }
    });

    /* ======================================================================
     * KILLER APP #2 — Industrial Safety Advisor (stub shape, real prompt)
     * ----------------------------------------------------------------------
     * Target: mining, construction, manufacturing sites in East Africa.
     * ==================================================================== */
    register({
        id: 'safety',
        name: 'Safety Advisor',
        icon: '🦺',
        description: 'Industrial safety procedures, hazards, and incident prevention',
        category: 'industrial',
        run: async (task) => {
            const system =
`You are the CephasGM SI Industrial Safety Advisor.
Scope: mining, construction, manufacturing, oil & gas — East African regulatory context (OSHA-TZ, NEMC).
Response format (always):
1. Hazard identification (bullets)
2. Immediate controls (hierarchy: eliminate → substitute → engineer → admin → PPE)
3. Regulatory references (specific where possible, general otherwise)
4. Escalation triggers (when to stop work)
If the situation is life-threatening, open with "STOP WORK" in bold.
Never guess at chemical names or quantities.`;
            const content = await infer(task, {
                task: 'analyze',
                system,
                useMemory: true
            });
            return { content };
        }
    });

    /* ======================================================================
     * Legacy single-shot helpers
     * ==================================================================== */
    const searchAgent    = (q)          => runAgent(q, 'search');
    const summarizeAgent = (text)       => runAgent(`Summarize: ${text}`, 'summarize');
    const translateAgent = (text, lang) => runAgent(`Translate to ${lang || 'Swahili'}: ${text}`, 'translate');
    const analyzeAgent   = (data)       => runAgent(data, 'analyze');
    const researchAgent  = (topic)      => runAgent(topic, 'research');
    const tutorAgent     = (q)          => runAgent(q, 'tutor');
    const safetyAgent    = (q)          => runAgent(q, 'safety');

    async function codeAgent(code, language = 'javascript') {
        return runAgent(
            `Language: ${language}\n\n${code}`,
            'code'
        );
    }

    /* ======================================================================
     * Public API
     * ==================================================================== */
    return {
        // registry
        register,
        unregister,
        get,
        list,

        // executor
        runAgent,

        // convenience wrappers (legacy compatible)
        searchAgent,
        summarizeAgent,
        translateAgent,
        analyzeAgent,
        researchAgent,
        codeAgent,

        // killer apps
        tutorAgent,
        safetyAgent,

        version: '6.0.0-si'
    };
})();

/* ======================================================================
 * Globals for legacy callers (app.js, index.html inline bootstrap)
 * ==================================================================== */
window.runAgent        = window.AgentsModule.runAgent;
window.searchAgent     = window.AgentsModule.searchAgent;
window.summarizeAgent  = window.AgentsModule.summarizeAgent;
window.translateAgent  = window.AgentsModule.translateAgent;
window.analyzeAgent    = window.AgentsModule.analyzeAgent;
window.researchAgent   = window.AgentsModule.researchAgent;
window.codeAgent       = window.AgentsModule.codeAgent;
window.tutorAgent      = window.AgentsModule.tutorAgent;
window.safetyAgent     = window.AgentsModule.safetyAgent;
