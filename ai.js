/**
 * AI Chat Interface - Core AI functionality
 * Fixed - Uses global namespace pattern
 */

window.AIModule = window.AIModule || (function() {
    const API_URL = window.CEPHASGM_CONFIG?.API_URL || "https://cephasgm-ai.onrender.com";
    
    async function askAI(message, history = []) {
        if (!message || message.trim() === "") {
            console.error("Message is required");
            return { 
                error: "Message is required", 
                content: "Please enter a message." 
            };
        }

        try {
            const response = await fetch(`${API_URL}/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    prompt: message,
                    model: "llama3.2",
                    history: history 
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Handle different response formats
            return {
                success: true,
                content: data.content || data.response || data.text || "No response",
                model: data.model || "llama3.2",
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("AI Error:", error);
            return { 
                success: false,
                error: "AI service unavailable",
                content: "I'm sorry, I'm having trouble connecting. Please check your internet and try again.",
                details: error.message
            };
        }
    }

    // Stream response (for typing effect)
    async function askAIStream(message, onChunk, onComplete, history = []) {
        try {
            const result = await askAI(message, history);
            
            if (!result.success) {
                onChunk(result.content);
                if (onComplete) onComplete(result.content);
                return;
            }

            const words = result.content.split(' ');
            
            for (let i = 0; i < words.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 50));
                onChunk(words[i] + (i < words.length - 1 ? ' ' : ''));
            }
            
            if (onComplete) onComplete(result.content);

        } catch (error) {
            console.error("AI Stream Error:", error);
            onChunk("Service unavailable. Please try again.");
            if (onComplete) onComplete("");
        }
    }

    // Public API
    return {
        askAI,
        askAIStream
    };
})();

// Export for global use
window.askAI = window.AIModule.askAI;
window.askAIStream = window.AIModule.askAIStream;
