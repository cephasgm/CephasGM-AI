/**
 * Main Application - Chat Interface
 * Connected to backend API at https://cephasgm-ai.onrender.com
 */

// API endpoint
const API_URL = "https://cephasgm-ai.onrender.com";

// DOM elements
let chatBox, input, sendBtn, voiceBtn;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  chatBox = document.getElementById("chat");
  input = document.getElementById("userInput");
  sendBtn = document.getElementById("sendBtn");
  voiceBtn = document.getElementById("voiceBtn");

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

  if (voiceBtn) {
    voiceBtn.addEventListener('click', startVoice);
  }

  // Load chat history from localStorage
  loadChatHistory();
});

// Send message to AI via backend API
async function sendMessage() {
  if (!input) return;
  
  const message = input.value.trim();
  if (!message) return;

  // Add user message to chat
  addMessage("You", message);
  input.value = "";

  // Show typing indicator
  const typingId = showTypingIndicator();

  try {
    // Call backend API
    const response = await fetch(`${API_URL}/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: message })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Remove typing indicator
    removeTypingIndicator(typingId);
    
    // Add AI response
    addMessage("CephasGM AI", data.response || "No response received");
    
    // Save to memory if available
    if (window.saveMemory) {
      window.saveMemory(message, data.response);
    }
    
  } catch (error) {
    removeTypingIndicator(typingId);
    addMessage("CephasGM AI", "Sorry, I encountered an error. Please try again.");
    console.error("Send message error:", error);
  }
}

// Add message to chat box
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
  
  // Save to localStorage
  saveChatToStorage(sender, text, timestamp);
}

// Show typing indicator
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

// Remove typing indicator
function removeTypingIndicator(id) {
  const indicator = document.getElementById(id);
  if (indicator) {
    indicator.remove();
  }
}

// Save chat to localStorage
function saveChatToStorage(sender, text, timestamp) {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    history.push({ sender, text, timestamp });
    
    // Keep only last 50 messages
    if (history.length > 50) {
      history.shift();
    }
    
    localStorage.setItem('chatHistory', JSON.stringify(history));
  } catch (error) {
    console.error("Error saving chat history:", error);
  }
}

// Load chat from localStorage
function loadChatHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    
    // Clear existing messages
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

// Clear chat history
function clearChat() {
  if (confirm("Clear all chat history?")) {
    localStorage.removeItem('chatHistory');
    if (chatBox) {
      chatBox.innerHTML = '';
      addMessage("CephasGM AI", "Chat history cleared. How can I help you?");
    }
  }
}

// Export functions
window.sendMessage = sendMessage;
window.addMessage = addMessage;
window.clearChat = clearChat;
