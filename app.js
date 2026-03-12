/**
 * Main Application - Chat Interface
 * Connected to backend API at https://cephasgm-ai.onrender.com
 */

// Use namespace to avoid globals
window.ChatApp = window.ChatApp || (function() {
    const API_URL = window.CEPHASGM_CONFIG?.API_URL || "https://cephasgm-ai.onrender.com";
    
    // DOM elements
    let chatBox, input, sendBtn;
    
    // Initialize when DOM is ready
    function init() {
        chatBox = document.getElementById("chat");
        input = document.getElementById("userInput");
        sendBtn = document.getElementById("sendBtn");
        
        // Note: voiceBtn is handled in voice.js now
        
        if (sendBtn) {
            sendBtn.addEventListener('click', sendMessage);
        }
        
        if (input) {
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });
        }
        
        loadChatHistory();
    }
    
    async function sendMessage() {
        if (!input) return;
        
        const message = input.value.trim();
        if (!message) return;
        
        addMessage("You", message);
        input.value = "";
        
        const typingId = showTypingIndicator();
        
        try {
            const response = await fetch(`${API_URL}/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    prompt: message,
                    model: "llama3.2"
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            removeTypingIndicator(typingId);
            
            const aiResponse = data.content || data.response || "No response received";
            addMessage("CephasGM AI", aiResponse);
            
            if (window.saveMemory) {
                window.saveMemory(message, aiResponse);
            }
            
        } catch (error) {
            removeTypingIndicator(typingId);
            addMessage("CephasGM AI", "Sorry, I encountered an error. Please try again.");
            console.error("Send message error:", error);
        }
    }
    
    function addMessage(sender, text) {
        if (!chatBox) return;
        
        const msg = document.createElement("div");
        msg.className = `message ${sender === "You" ? "user-message" : "ai-message"}`;
        
        const timestamp = new Date().toLocaleTimeString();
        
        msg.innerHTML = `
            <div class="message-header">
                <b>${sender}:</b>
                <span class="timestamp">${timestamp}</span>
            </div>
            <div class="message-content">${text}</div>
        `;
        
        chatBox.appendChild(msg);
        chatBox.scrollTop = chatBox.scrollHeight;
        
        saveChatToStorage(sender, text, timestamp);
    }
    
    function showTypingIndicator() {
        const id = 'typing-' + Date.now();
        const div = document.createElement("div");
        div.id = id;
        div.className = "message ai-message typing-indicator";
        div.innerHTML = `
            <div class="message-header">
                <b>CephasGM AI:</b>
            </div>
            <div class="message-content">
                <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
            </div>
        `;
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
        return id;
    }
    
    function removeTypingIndicator(id) {
        const indicator = document.getElementById(id);
        if (indicator) indicator.remove();
    }
    
    function saveChatToStorage(sender, text, timestamp) {
        try {
            const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
            history.push({ sender, text, timestamp });
            
            if (history.length > 50) history.shift();
            
            localStorage.setItem('chatHistory', JSON.stringify(history));
        } catch (error) {
            console.error("Error saving chat history:", error);
        }
    }
    
    function loadChatHistory() {
        try {
            const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
            
            if (chatBox) {
                chatBox.innerHTML = '';
                
                if (history.length === 0) {
                    addMessage("CephasGM AI", "Hello! I'm CephasGM AI. How can I help you today?");
                } else {
                    history.forEach(msg => {
                        const msgDiv = document.createElement("div");
                        msgDiv.className = `message ${msg.sender === "You" ? "user-message" : "ai-message"}`;
                        msgDiv.innerHTML = `
                            <div class="message-header">
                                <b>${msg.sender}:</b>
                                <span class="timestamp">${msg.timestamp}</span>
                            </div>
                            <div class="message-content">${msg.text}</div>
                        `;
                        chatBox.appendChild(msgDiv);
                    });
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            }
        } catch (error) {
            console.error("Error loading chat history:", error);
        }
    }
    
    function clearChat() {
        if (confirm("Clear all chat history?")) {
            localStorage.removeItem('chatHistory');
            if (chatBox) {
                chatBox.innerHTML = '';
                addMessage("CephasGM AI", "Chat history cleared. How can I help you?");
            }
        }
    }
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Public API
    return {
        sendMessage,
        addMessage,
        clearChat
    };
})();
