const functions = require("firebase-functions");
const fetch = require("node-fetch");

/**
 * AI Chat Engine
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/chat
 */
exports.chat = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const { prompt, history } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }

    // Format messages with history if provided
    const messages = [];
    
    // Add system message
    messages.push({
      role: "system",
      content: "You are CephasGM AI, an African-inspired artificial intelligence assistant. You are helpful, creative, and culturally aware."
    });
    
    // Add conversation history if provided
    if (history && Array.isArray(history)) {
      messages.push(...history);
    }
    
    // Add current prompt
    messages.push({
      role: "user",
      content: prompt
    });

    // For demo/development without actual API key, use mock response
    let reply;
    const openAIKey = process.env.OPENAI_KEY;

    if (openAIKey && openAIKey !== "sk-demo-key") {
      // Real OpenAI API call
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAIKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: messages,
          max_tokens: 500,
          temperature: 0.7
        })
      });

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        reply = data.choices[0].message.content;
      } else {
        reply = "I'm having trouble processing that right now. Please try again.";
      }
    } else {
      // Mock response for development
      const mockResponses = [
        `As CephasGM AI, I understand you're asking about "${prompt.substring(0, 50)}". That's an interesting topic!`,
        `I'm here to help with your question about African innovation and technology.`,
        `Great question! Let me think about that from an African perspective.`,
        `I'd be happy to help you with that. What specific aspects interest you?`
      ];
      reply = mockResponses[Math.floor(Math.random() * mockResponses.length)];
    }

    res.json({
      reply: reply,
      timestamp: Date.now(),
      model: "cephasgm-ai-v2"
    });

  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      error: "AI chat service unavailable", 
      reply: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."
    });
  }
});
