/**
 * CephasGM SI — voice.js
 * ----------------------------------------------------------------------------
 * Robust VAD + turn-taking engine for voice mode.
 *
 * Implements the listen → process → respond loop described in Review #1:
 *   - Explicit state machine (idle / listening / processing / speaking)
 *   - Barge-in: user interrupts AI at any time
 *   - Silence detection: auto-finalize after N ms of quiet
 *   - Hard caps: max listen duration, min transcript length
 *   - State is published to #voice-status[data-state] for the UI
 *   - Pluggable VAD provider (Phase 2 will inject a real one)
 *
 * This module is the SOLE owner of voice behavior. The inline voice block in
 * index.html is scheduled for removal in the next index.html pass.
 * ----------------------------------------------------------------------------
 */

window.VoiceModule = window.VoiceModule || (function () {
    'use strict';

    /* ======================================================================
     * Configuration
     * ==================================================================== */
    const CFG = {
        lang:             'en-US',
        silenceMs:        900,     // finalize after this much quiet
        minChars:         2,       // ignore transcripts shorter than this
        maxListenMs:      15000,   // hard cap on one listening turn
        autoSend:         true,    // auto-fire streamMessage on final
        autoSpeak:        false,   // TTS the AI response (opt-in for now)
        interimFeedback:  true,    // write interim transcript into composer
    };

    /* ======================================================================
     * State machine
     * ==================================================================== */
    const State = Object.freeze({
        IDLE:       'idle',
        LISTENING:  'listening',
        PROCESSING: 'processing',
        SPEAKING:   'speaking'
    });

    let state = State.IDLE;
    const subscribers = new Set();

    function setState(next) {
        if (state === next) return;
        state = next;
        renderState();
        subscribers.forEach(fn => {
            try { fn(next); } catch (e) { console.warn('[Voice] subscriber error', e); }
        });
    }

    function getState() { return state; }

    function onStateChange(fn) {
        subscribers.add(fn);
        fn(state); // fire immediately with current
        return () => subscribers.delete(fn);
    }

    /* ======================================================================
     * DOM refs
     * ==================================================================== */
    let voiceBtn, voiceStatusEl, voiceStatusText, userInput, composerHint;
    let lastHint = '';

    function bindDom() {
        voiceBtn        = document.getElementById('voiceBtn');
        voiceStatusEl   = document.getElementById('voice-status');
        voiceStatusText = document.getElementById('voice-status-text');
        userInput       = document.getElementById('userInput');
        composerHint    = document.getElementById('composerHint');
    }

    function renderState() {
        if (voiceBtn) {
            voiceBtn.classList.toggle('listening', state === State.LISTENING);
            voiceBtn.classList.toggle('processing', state === State.PROCESSING);
            voiceBtn.classList.toggle('speaking', state === State.SPEAKING);
            voiceBtn.setAttribute('aria-pressed', String(state === State.LISTENING));
            voiceBtn.title = {
                [State.IDLE]:       'Start voice input',
                [State.LISTENING]:  'Stop listening',
                [State.PROCESSING]: 'Processing…',
                [State.SPEAKING]:   'Interrupt and speak'
            }[state];
        }

        if (voiceStatusEl) {
            voiceStatusEl.dataset.state = state;
            voiceStatusEl.classList.toggle('visible', state !== State.IDLE);
        }

        if (voiceStatusText) {
            const label = {
                [State.IDLE]:       '',
                [State.LISTENING]:  'Listening…',
                [State.PROCESSING]: 'Processing…',
                [State.SPEAKING]:   'Speaking…'
            }[state];
            if (label !== lastHint) {
                voiceStatusText.textContent = label;
                lastHint = label;
            }
        }
    }

    /* ======================================================================
     * Pluggable VAD provider (Phase 2 hook)
     * ----------------------------------------------------------------------
     * Real VAD (energy / Silero / WebRTC) will be injected from audio-engine.js.
     * For now, we rely on SpeechRecognition's built-in endpointing.
     * ==================================================================== */
    let vadProvider = null;
    function setVADProvider(provider) {
        vadProvider = provider;
        if (vadProvider && typeof vadProvider.start === 'function') {
            vadProvider.start(() => {
                // VAD detected speech onset
                if (state === State.SPEAKING) bargeIn();
            });
        }
    }

    /* ======================================================================
     * SpeechRecognition setup
     * ==================================================================== */
    let recognition = null;
    let silenceTimer = null;
    let maxListenTimer = null;
    let finalTranscript = '';
    let sawResult = false;

    function isVoiceSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    function ensureRecognition() {
        if (recognition) return recognition;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            console.warn('[Voice] SpeechRecognition unsupported');
            return null;
        }

        recognition = new SR();
        recognition.continuous     = true;   // keep listening across pauses
        recognition.interimResults = true;   // live feedback
        recognition.lang           = CFG.lang;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            finalTranscript = '';
            sawResult = false;
            setState(State.LISTENING);
            armMaxListenTimer();
        };

        recognition.onresult = (event) => {
            let interim = '';
            let chunkFinal = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const r = event.results[i];
                const txt = r[0].transcript;
                if (r.isFinal) chunkFinal += txt;
                else interim += txt;
            }

            if (chunkFinal) {
                finalTranscript += chunkFinal;
                sawResult = true;
            }

            // Live UI feedback
            if (CFG.interimFeedback && userInput) {
                userInput.value = (finalTranscript + interim).trim();
                if (typeof window.autoGrow === 'function') {
                    window.autoGrow(userInput);
                } else {
                    userInput.style.height = 'auto';
                    userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
                }
            }

            // Reset silence timer on every activity
            if (interim || chunkFinal) armSilenceTimer();
        };

        recognition.onerror = (event) => {
            const msg = {
                'no-speech':     'No speech detected',
                'audio-capture': 'Microphone unavailable',
                'not-allowed':   'Microphone permission denied',
                'aborted':       'Listening stopped',
                'network':       'Speech service unreachable'
            }[event.error] || `Voice error: ${event.error}`;

            if (window.toast) window.toast(msg);
            else console.warn('[Voice]', msg);

            clearTimers();
            setState(State.IDLE);
        };

        recognition.onend = () => {
            // onend fires after onresult in one-shot mode; with continuous=true
            // it fires when we explicitly stop, so only finalize if we have text.
            if (state === State.LISTENING) {
                finalize();
            } else {
                clearTimers();
            }
        };

        return recognition;
    }

    /* ======================================================================
     * Timers
     * ==================================================================== */
    function armSilenceTimer() {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (state === State.LISTENING && sawResult) {
                stopVoice();
            }
        }, CFG.silenceMs);
    }

    function armMaxListenTimer() {
        clearTimeout(maxListenTimer);
        maxListenTimer = setTimeout(() => {
            if (state === State.LISTENING) {
                if (window.toast) window.toast('Listening timed out');
                stopVoice();
            }
        }, CFG.maxListenMs);
    }

    function clearTimers() {
        clearTimeout(silenceTimer);
        clearTimeout(maxListenTimer);
        silenceTimer = null;
        maxListenTimer = null;
    }

    /* ======================================================================
     * Turn lifecycle
     * ==================================================================== */
    function startVoice() {
        if (state === State.SPEAKING) {
            // Barge-in: user is starting a new turn — stop any TTS first.
            bargeIn();
        }
        if (state === State.PROCESSING) return; // don't interrupt the pipeline
        if (state === State.LISTENING) return;  // already listening

        const rec = ensureRecognition();
        if (!rec) {
            if (window.toast) window.toast('Voice not supported in this browser');
            return;
        }

        try {
            rec.start();
        } catch (err) {
            // Chrome throws if already started — treat as benign
            if (!/already started|started/i.test(err.message || '')) {
                console.warn('[Voice] start failed', err);
                if (window.toast) window.toast('Could not start microphone');
                setState(State.IDLE);
            }
        }
    }

    function stopVoice() {
        clearTimers();
        if (recognition && state === State.LISTENING) {
            try { recognition.stop(); } catch {}
        }
        if (state === State.LISTENING) {
            finalize();
        }
    }

    function toggleVoice() {
        switch (state) {
            case State.IDLE:       startVoice();  break;
            case State.LISTENING:  stopVoice();   break;
            case State.SPEAKING:   bargeIn();     break;
            case State.PROCESSING: /* ignore */   break;
        }
    }

    /**
     * Finalize a listening turn: validate, then hand off to streamMessage().
     */
    function finalize() {
        const text = (finalTranscript || (userInput && userInput.value) || '').trim();
        finalTranscript = '';

        if (text.length < CFG.minChars) {
            setState(State.IDLE);
            if (userInput) userInput.value = '';
            return;
        }

        if (userInput) userInput.value = text;

        if (!CFG.autoSend) {
            setState(State.IDLE);
            return;
        }

        setState(State.PROCESSING);
        runPipeline(text);
    }

    /**
     * Fire the canonical send and, if configured, speak the response.
     * Wraps streamMessage so we can transition state correctly.
     */
    async function runPipeline(text) {
        try {
            const fn = window.streamMessage || window.sendMessage;
            if (typeof fn === 'function') {
                // Our canonical streamMessage is not promise-returning in all builds;
                // guard both cases.
                const result = fn.call(window);
                if (result && typeof result.then === 'function') {
                    await result;
                } else {
                    // Best-effort wait for the streaming UI to complete.
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        } catch (e) {
            console.warn('[Voice] pipeline error', e);
        } finally {
            if (CFG.autoSpeak) {
                // The chat layer will call VoiceModule.speak() with the final text.
                setState(State.SPEAKING);
            } else {
                setState(State.IDLE);
            }
        }
    }

    /* ======================================================================
     * Barge-in
     * ==================================================================== */
    function bargeIn() {
        // Cancel any TTS mid-utterance, then switch into listening.
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch {}
        }
        if (state === State.SPEAKING) setState(State.IDLE);
        // Give Chrome a beat to release the speech channel before re-grabbing it
        setTimeout(() => startVoice(), 80);
    }

    /* ======================================================================
     * Speech synthesis
     * ==================================================================== */
    function getVoicesAsync() {
        return new Promise(resolve => {
            const v = window.speechSynthesis && window.speechSynthesis.getVoices();
            if (v && v.length) return resolve(v);
            if (!window.speechSynthesis) return resolve([]);
            window.speechSynthesis.onvoiceschanged = () =>
                resolve(window.speechSynthesis.getVoices());
        });
    }

    /**
     * speak(text, { force })
     * If the user is currently speaking, we DO NOT interrupt them —
     * this is the "user wins" rule. Pass { force: true } to override.
     */
    async function speak(text, opts = {}) {
        if (!text) return false;
        if (!window.speechSynthesis) {
            if (window.toast) window.toast('Speech not supported');
            return false;
        }
        if (state === State.LISTENING && !opts.force) {
            return false; // user wins
        }

        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = CFG.lang;
        utter.rate = 1.0;
        utter.pitch = 1.0;

        const voices = await getVoicesAsync();
        const preferred =
            voices.find(v => /samantha|victoria|zira|karen|female/i.test(v.name) && /en/i.test(v.lang)) ||
            voices.find(v => /en/i.test(v.lang));
        if (preferred) utter.voice = preferred;

        window.speechSynthesis.cancel();
        setState(State.SPEAKING);

        return new Promise(resolve => {
            utter.onend = () => { setState(State.IDLE); resolve(true); };
            utter.onerror = () => { setState(State.IDLE); resolve(false); };
            try { window.speechSynthesis.speak(utter); }
            catch (e) { console.warn('[Voice] speak failed', e); setState(State.IDLE); resolve(false); }
        });
    }

    /* ======================================================================
     * Take-over from inline bootstrap
     * ----------------------------------------------------------------------
     * index.html's inline bootstrap declares global initVoice/startVoice/
     * stopVoice/toggleVoice/speak. Those are dead once we arrive; we must
     * ensure the LOAD handler that calls initVoice() runs, then we overwrite
     * everything immediately after (microtask after load).
     * ==================================================================== */
    function bindVoiceButton() {
        if (!voiceBtn) return;
        if (voiceBtn.dataset.voiceBound === '1') return;
        voiceBtn.addEventListener('click', toggleVoice);
        voiceBtn.dataset.voiceBound = '1';
    }

    function takeOver() {
        bindDom();
        renderState();
        bindVoiceButton();

        // Neutralize the inline bootstrap's functions.
        window.initVoice  = () => {};
        window.startVoice = startVoice;
        window.stopVoice  = stopVoice;
        window.toggleVoice= toggleVoice;
        window.speak      = speak;
        window.VoiceModule.startVoice  = startVoice;
        window.VoiceModule.stopVoice   = stopVoice;
        window.VoiceModule.toggleVoice = toggleVoice;
        window.VoiceModule.speak       = speak;
    }

    function scheduleTakeOver() {
        // Run AFTER the inline load handler that calls initVoice()
        setTimeout(takeOver, 0);
    }

    if (document.readyState === 'complete') {
        scheduleTakeOver();
    } else {
        window.addEventListener('load', scheduleTakeOver, { once: true });
    }

    /* ======================================================================
     * Public API
     * ==================================================================== */
    return {
        // controls
        startVoice,
        stopVoice,
        toggleVoice,
        speak,

        // state
        getState,
        onStateChange,
        State,

        // config
        configure(patch) { Object.assign(CFG, patch); },
        getConfig()      { return { ...CFG }; },

        // capability
        isVoiceSupported,

        // Phase 2 hook
        setVADProvider,

        // internal (debug)
        _finalize:        finalize,
        _bargeIn:         bargeIn,
        _ensureRecognition: ensureRecognition,

        version: '6.0.0-si'
    };
})();
