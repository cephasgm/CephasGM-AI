/**
 * AI Chat Interface - Core AI functionality
 */

async function askAI(message, history = []) {
  if (!message || message.trim() === "") {
    console.error("Message is required");
    return { error: "Message is required", reply: "Please enter a message." };
  }

  try {
    const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        prompt: message,
        history: history 
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error("AI Error:", error);
    return { 
      error: "AI service unavailable",
      reply: "I'm sorry, I'm having trouble connecting. Please check your internet and try again.",
      details: error.message
    };
  }
}

// Stream response (for typing effect)
async function askAIStream(message, onChunk, onComplete, history = []) {
  try {
    const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        prompt: message,
        history: history,
        stream: true 
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Simulate streaming for now
    const reply = data.reply || "No response";
    const words = reply.split(' ');
    
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      onChunk(words[i] + (i < words.length - 1 ? ' ' : ''));
    }
    
    if (onComplete) onComplete(reply);

  } catch (error) {
    console.error("AI Stream Error:", error);
    onChunk("Service unavailable. Please try again.");
    if (onComplete) onComplete("");
  }
}

// Export for use in app.js
window.askAI = askAI;
window.askAIStream = askAIStream;
