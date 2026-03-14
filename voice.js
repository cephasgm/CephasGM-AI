/**
 * Voice Recognition and Synthesis
 * Fixed - No duplicate declarations, auto‑send with streaming
 */

window.VoiceModule = window.VoiceModule || (function() {
    // Private variables
    let recognition = null;
    let synthesis = null;
    let isListening = false;
    let voiceBtn, voiceStatus, voiceOutput;
    
    // Initialize when DOM is ready
    function init() {
        voiceBtn = document.getElementById("voiceBtn");
        voiceStatus = document.getElementById("voiceStatus");
        voiceOutput = document.getElementById("voiceOutput");
        
        initSpeechRecognition();
        initSpeechSynthesis();
        
        if (voiceBtn) {
            voiceBtn.addEventListener('click', toggleVoice);
        }
    }
    
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        
        if (!SpeechRecognition) {
            console.warn("Speech recognition not supported");
            if (voiceStatus) {
                voiceStatus.textContent = "Voice recognition not supported in this browser";
            }
            return;
        }
        
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;
        
        recognition.onstart = function() {
            isListening = true;
            updateVoiceUI();
            if (voiceStatus) {
                voiceStatus.textContent = "Listening... Speak now";
            }
        };
        
        recognition.onend = function() {
            isListening = false;
            updateVoiceUI();
            if (voiceStatus) {
                voiceStatus.textContent = "Voice recognition stopped";
                setTimeout(() => {
                    if (voiceStatus && !isListening) {
                        voiceStatus.textContent = "";
                    }
                }, 3000);
            }
        };
        
        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            
            if (voiceOutput) {
                voiceOutput.value = transcript;
            }
            
            // Put transcript in the main input
            const userInput = document.getElementById("userInput");
            if (userInput) {
                userInput.value = transcript;
            }
            
            if (voiceStatus) {
                voiceStatus.textContent = `Recognized: "${transcript}" – sending...`;
            }
            
            // Automatically send using streaming (if available)
            if (typeof window.streamMessage === 'function') {
                window.streamMessage();
            } else if (typeof window.sendMessage === 'function') {
                window.sendMessage();
            }
        };
        
        recognition.onerror = function(event) {
            console.error("Speech recognition error:", event.error);
            
            let errorMessage = "Voice recognition error";
            switch(event.error) {
                case 'no-speech':
                    errorMessage = "No speech detected. Please try again.";
                    break;
                case 'audio-capture':
                    errorMessage = "No microphone found.";
                    break;
                case 'not-allowed':
                    errorMessage = "Microphone access denied.";
                    break;
                default:
                    errorMessage = `Error: ${event.error}`;
            }
            
            if (voiceStatus) {
                voiceStatus.textContent = errorMessage;
            }
            
            isListening = false;
            updateVoiceUI();
        };
    }
    
    function initSpeechSynthesis() {
        if (!window.speechSynthesis) {
            console.warn("Speech synthesis not supported");
            return;
        }
        synthesis = window.speechSynthesis;
    }
    
    function toggleVoice() {
        if (!recognition) {
            alert("Voice recognition is not supported in your browser.");
            return;
        }
        
        if (isListening) {
            stopVoice();
        } else {
            startVoice();
        }
    }
    
    function startVoice() {
        if (!recognition) return;
        
        try {
            recognition.start();
        } catch (error) {
            console.error("Failed to start voice recognition:", error);
            if (error.message.includes('started')) {
                stopVoice();
                setTimeout(() => recognition.start(), 100);
            }
        }
    }
    
    function stopVoice() {
        if (!recognition) return;
        
        try {
            recognition.stop();
        } catch (error) {
            console.error("Error stopping voice recognition:", error);
        }
        
        isListening = false;
        updateVoiceUI();
    }
    
    function updateVoiceUI() {
        if (!voiceBtn) return;
        
        if (isListening) {
            voiceBtn.classList.add('listening');
            voiceBtn.innerHTML = '🎤 Listening...';
        } else {
            voiceBtn.classList.remove('listening');
            voiceBtn.innerHTML = '🎤 Start Voice';
        }
    }
    
    function speak(text) {
        if (!synthesis) {
            alert("Speech synthesis not supported");
            return;
        }
        
        synthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        const voices = synthesis.getVoices();
        const preferredVoice = voices.find(voice => 
            voice.lang.includes('en') && (voice.name.includes('Google') || voice.name.includes('Female'))
        );
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        utterance.onstart = () => {
            if (voiceStatus) voiceStatus.textContent = "Speaking...";
        };
        
        utterance.onend = () => {
            if (voiceStatus) voiceStatus.textContent = "";
        };
        
        utterance.onerror = (event) => {
            console.error("Speech synthesis error:", event);
            if (voiceStatus) voiceStatus.textContent = "Speech synthesis error";
        };
        
        synthesis.speak(utterance);
    }
    
    function isVoiceSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
    
    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Public API
    return {
        startVoice,
        stopVoice,
        toggleVoice,
        speak,
        isVoiceSupported
    };
})();
