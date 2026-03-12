/**
 * Central Configuration for CephasGM AI Frontend
 * Load this FIRST before any other scripts
 */

window.CEPHASGM_CONFIG = {
    // Backend API URL
    API_URL: "https://cephasgm-ai.onrender.com",
    
    // Firebase Configuration
    FIREBASE: {
        apiKey: "AIzaSyAukJQx3pEqXoyFR9tyfeLckJaBIgYtGFA",
        authDomain: "cephasgm-ai.firebaseapp.com",
        projectId: "cephasgm-ai",
        storageBucket: "cephasgm-ai.firebasestorage.app",
        messagingSenderId: "304163647028",
        appId: "1:304163647028:web:2920b2cfb9be4049806461"
    },
    
    // Available AI Models
    MODELS: {
        CHAT: ['llama3.2', 'llama3', 'mistral', 'phi3'],
        IMAGE: ['dall-e-2', 'dall-e-3', 'stable-diffusion'],
        AUDIO: ['whisper', 'tts-1'],
        VIDEO: ['gen-2', 'svd']
    },
    
    // Feature Flags
    FEATURES: {
        voiceInput: true,
        imageGeneration: true,
        videoGeneration: true,
        codeExecution: true,
        memory: true
    },
    
    // UI Configuration
    UI: {
        maxChatHistory: 50,
        maxFileSize: 10 * 1024 * 1024, // 10MB
        typingIndicator: true,
        autoSaveChat: true
    },
    
    // Debug Mode
    DEBUG: true
};

// Log configuration in debug mode
if (window.CEPHASGM_CONFIG.DEBUG) {
    console.log('🚀 CephasGM AI Configuration loaded:', {
        apiUrl: window.CEPHASGM_CONFIG.API_URL,
        features: window.CEPHASGM_CONFIG.FEATURES,
        timestamp: new Date().toISOString()
    });
}
