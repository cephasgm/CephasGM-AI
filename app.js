/**
 * Main Application - Chat Interface
 */

// DOM elements
let chatBox, input, sendBtn, voiceBtn;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  chatBox = document.getElementById("chat");
  input = document.getElementById("prompt");
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

// Send message to AI
async function sendMessage() {
  if (!input) return;
  
  const prompt = input.value.trim();
  if (!prompt) return;

  // Add user message to chat
  addMessage("You", prompt);
  input.value = "";

  // Show typing indicator
  const typingId = showTypingIndicator();

  try {
    // Call AI
    const result = await window.askAI(prompt);
    
    // Remove typing indicator
    removeTypingIndicator(typingId);
    
    // Add AI response
    addMessage("CephasAI", result.reply || "No response received");
    
    // Save to memory if available
    if (window.saveMemory) {
      window.saveMemory(prompt, result.reply);
    }
    
  } catch (error) {
    removeTypingIndicator(typingId);
    addMessage("CephasAI", "Sorry, I encountered an error. Please try again.");
    console.error("Send message error:", error);
  }
}

// Add message to chat box
function addMessage(user, text) {
  if (!chatBox) return;
  
  const div = document.createElement("div");
  div.className = `message ${user === "You" ? "user-message" : "ai-message"}`;
  
  const timestamp = new Date().toLocaleTimeString();
  
  div.innerHTML = `
    <div class="message-header">
      <strong>${user}:</strong>
      <span class="timestamp">${timestamp}</span>
    </div>
    <div class="message-content">${text}</div>
  `;
  
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  
  // Save to localStorage
  saveChatToStorage(user, text, timestamp);
}

// Show typing indicator
function showTypingIndicator() {
  const id = 'typing-' + Date.now();
  const div = document.createElement("div");
  div.id = id;
  div.className = "message ai-message typing-indicator";
  div.innerHTML = `
    <div class="message-header">
      <strong>CephasAI:</strong>
    </div>
    <div class="message-content">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
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
function saveChatToStorage(user, text, timestamp) {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    history.push({ user, text, timestamp });
    
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
    
    // Clear existing messages except welcome
    if (chatBox && history.length === 0) {
      addMessage("CephasAI", "Hello! I'm CephasGM AI. How can I help you today?");
    } else {
      history.forEach(msg => {
        const div = document.createElement("div");
        div.className = `message ${msg.user === "You" ? "user-message" : "ai-message"}`;
        div.innerHTML = `
          <div class="message-header">
            <strong>${msg.user}:</strong>
            <span class="timestamp">${msg.timestamp}</span>
          </div>
          <div class="message-content">${msg.text}</div>
        `;
        chatBox.appendChild(div);
      });
      chatBox.scrollTop = chatBox.scrollHeight;
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
      addMessage("CephasAI", "Chat history cleared. How can I help you?");
    }
  }
}

// Export functions
window.sendMessage = sendMessage;
window.addMessage = addMessage;
window.clearChat = clearChat;
