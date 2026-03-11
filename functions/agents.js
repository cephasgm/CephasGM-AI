const functions = require("firebase-functions");
const fetch = require("node-fetch");

/**
 * AI Agents - Execute automated tasks
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/agent
 */
exports.agent = functions.https.onRequest(async (req, res) => {
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
    const { task, type } = req.body;

    if (!task) {
      res.status(400).json({ error: "Task is required" });
      return;
    }

    // Execute different agent types based on task content or explicit type
    let result;
    const taskLower = task.toLowerCase();

    if (type === "search" || taskLower.includes("search") || taskLower.includes("find")) {
      result = await searchAgent(task);
    } else if (type === "summarize" || taskLower.includes("summarize") || taskLower.includes("summary")) {
      result = await summarizeAgent(task);
    } else if (type === "translate" || taskLower.includes("translate")) {
      result = await translateAgent(task);
    } else if (type === "analyze" || taskLower.includes("analyze") || taskLower.includes("analysis")) {
      result = await analyzeAgent(task);
    } else {
      // Default to chat agent
      result = await chatAgent(task);
    }

    res.json({
      success: true,
      task: task,
      agent: result.agent,
      result: result.data,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error("Agent error:", error);
    res.status(500).json({ 
      error: "Agent execution failed", 
      details: error.message 
    });
  }
});

// Agent: Search
async function searchAgent(query) {
  // Simulate search - in production, integrate with Google Search API, etc.
  return {
    agent: "search",
    data: `Search results for: "${query}"\n• Found 3 relevant results\n• Top result: Example.com\n• Related: More information available`
  };
}

// Agent: Summarize
async function summarizeAgent(text) {
  return {
    agent: "summarize",
    data: `Summary: ${text.substring(0, 100)}... [This is a summarized version of the provided text]`
  };
}

// Agent: Translate
async function translateAgent(text) {
  return {
    agent: "translate",
    data: `[Translation] ${text} (translated to English)`
  };
}

// Agent: Analyze
async function analyzeAgent(data) {
  return {
    agent: "analyze",
    data: `Analysis complete:\n• Sentiment: Positive\n• Key topics: AI, Technology, Africa\n• Recommendations: Continue development`
  };
}

// Agent: Chat
async function chatAgent(message) {
  return {
    agent: "chat",
    data: `I'm your CephasGM AI agent. I received: "${message}". How can I help you further?`
  };
}
