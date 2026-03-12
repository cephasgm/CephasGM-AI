/**
 * AI Agents - Execute automated tasks from the frontend
 * Fixed - Uses global namespace pattern
 */

window.AgentsModule = window.AgentsModule || (function() {
    const API_URL = window.CEPHASGM_CONFIG?.API_URL || "https://cephasgm-ai.onrender.com";
    
    async function runAgent(task, type = "auto") {
        if (!task || task.trim() === "") {
            console.error("Task is required");
            return { 
                error: "Task is required",
                content: "Please provide a task for the agent."
            };
        }

        try {
            // Map agent types to backend endpoints
            const endpoint = type === "search" ? "/research" : 
                           type === "code" ? "/code" : 
                           type === "task" ? "/task" : "/chat";

            const response = await fetch(`${API_URL}${endpoint}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    [type === "search" ? "topic" : "prompt"]: task,
                    type: type
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            return {
                success: true,
                content: data.content || data.response || data.output || data.summary || "Task completed",
                type: type,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("Agent error:", error);
            return { 
                success: false,
                error: "Agent service unavailable",
                content: `I'll help you with: "${task}" directly.`,
                details: error.message
            };
        }
    }

    // Specific agent functions
    async function searchAgent(query) {
        return runAgent(query, "search");
    }

    async function summarizeAgent(text) {
        return runAgent(`Summarize: ${text}`, "summarize");
    }

    async function translateAgent(text, targetLanguage = "en") {
        return runAgent(`Translate to ${targetLanguage}: ${text}`, "translate");
    }

    async function analyzeAgent(data) {
        return runAgent(data, "analyze");
    }

    async function codeAgent(code, language = "javascript") {
        try {
            const response = await fetch(`${API_URL}/code`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    code: code,
                    language: language,
                    analyze: true
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            return {
                success: true,
                output: data.output || data.result,
                analysis: data.aiAnalysis,
                language: language,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("Code agent error:", error);
            return { 
                success: false,
                error: error.message,
                output: "Code execution failed"
            };
        }
    }

    // Public API
    return {
        runAgent,
        searchAgent,
        summarizeAgent,
        translateAgent,
        analyzeAgent,
        codeAgent
    };
})();

// Export for global use
window.runAgent = window.AgentsModule.runAgent;
window.searchAgent = window.AgentsModule.searchAgent;
window.summarizeAgent = window.AgentsModule.summarizeAgent;
window.translateAgent = window.AgentsModule.translateAgent;
window.analyzeAgent = window.AgentsModule.analyzeAgent;
window.codeAgent = window.AgentsModule.codeAgent;
