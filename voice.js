/**
 * Voice Recognition and Synthesis
 */

let recognition = null;
let synthesis = null;
let isListening = false;
let voiceBtn, voiceStatus, voiceOutput;

document.addEventListener('DOMContentLoaded', function() {
  voiceBtn = document.getElementById("voiceBtn");
  voiceStatus = document.getElementById("voiceStatus");
  voiceOutput = document.getElementById("voiceOutput");
  
  // Initialize speech recognition
  initSpeechRecognition();
  
  // Initialize speech synthesis
  initSpeechSynthesis();
  
  if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoice);
  }
});

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
  
  // Set up event handlers
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
    const confidence = event.results[0][0].confidence;
    
    if (voiceOutput) {
      voiceOutput.value = transcript;
    }
    
    // Also populate main prompt if it exists
    const promptInput = document.getElementById("prompt");
    if (promptInput) {
      promptInput.value = transcript;
    }
    
    if (voiceStatus) {
      voiceStatus.textContent = `Recognized: "${transcript}" (${Math.round(confidence * 100)}% confidence)`;
    }
    
    // Optional: automatically send after voice input
    autoSendAfterVoice();
  };
  
  recognition.onerror = function(event) {
    console.error("Speech recognition error:", event.error);
    
    let errorMessage = "Voice recognition error";
    switch(event.error) {
      case 'no-speech':
        errorMessage = "No speech detected. Please try again.";
        break;
      case 'audio-capture':
        errorMessage = "No microphone found or microphone not working.";
        break;
      case 'not-allowed':
        errorMessage = "Microphone access denied. Please allow microphone access.";
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
    alert("Voice recognition is not supported in your browser. Try Chrome or Edge.");
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
    
    // If already started, stop and restart
    if (error.message.includes('started')) {
      stopVoice();
      setTimeout(() => {
        try {
          recognition.start();
        } catch (e) {
          console.error("Retry failed:", e);
        }
      }, 100);
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

function autoSendAfterVoice() {
  // Automatically send message 1 second after voice input
  const sendBtn = document.getElementById("sendBtn");
  const promptInput = document.getElementById("prompt");
  
  if (sendBtn && promptInput && promptInput.value.trim()) {
    setTimeout(() => {
      sendBtn.click();
    }, 1000);
  }
}

/**
 * Text-to-Speech
 */
function speak(text) {
  if (!synthesis) {
    alert("Speech synthesis not supported");
    return;
  }
  
  // Cancel any ongoing speech
  synthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  
  // Get available voices and try to select a good one
  const voices = synthesis.getVoices();
  const preferredVoice = voices.find(voice => 
    voice.lang.includes('en') && voice.name.includes('Google') || voice.name.includes('Female')
  );
  
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  
  utterance.onstart = function() {
    if (voiceStatus) {
      voiceStatus.textContent = "Speaking...";
    }
  };
  
  utterance.onend = function() {
    if (voiceStatus) {
      voiceStatus.textContent = "";
    }
  };
  
  utterance.onerror = function(event) {
    console.error("Speech synthesis error:", event);
    if (voiceStatus) {
      voiceStatus.textContent = "Speech synthesis error";
    }
  };
  
  synthesis.speak(utterance);
}

/**
 * Check if voice is supported
 */
function isVoiceSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Export functions
window.startVoice = startVoice;
window.stopVoice = stopVoice;
window.toggleVoice = toggleVoice;
window.speak = speak;
window.isVoiceSupported = isVoiceSupported;
