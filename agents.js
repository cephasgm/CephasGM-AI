/**
 * AI Agents - Execute automated tasks from the frontend
 */

async function runAgent(task, type = "auto") {
  if (!task || task.trim() === "") {
    console.error("Task is required");
    return { error: "Task is required" };
  }

  try {
    const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        task: task,
        type: type 
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error("Agent error:", error);
    return { 
      error: "Agent service unavailable",
      details: error.message,
      fallback: `I'll help you with: "${task}" directly.`
    };
  }
}

// Specific agent functions
async function searchAgent(query) {
  return runAgent(query, "search");
}

async function summarizeAgent(text) {
  return runAgent(text, "summarize");
}

async function translateAgent(text, targetLanguage = "en") {
  return runAgent(`Translate to ${targetLanguage}: ${text}`, "translate");
}

async function analyzeAgent(data) {
  return runAgent(data, "analyze");
}

// Export for use
window.runAgent = runAgent;
window.searchAgent = searchAgent;
window.summarizeAgent = summarizeAgent;
window.translateAgent = translateAgent;
window.analyzeAgent = analyzeAgent;
