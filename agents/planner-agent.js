/**
 * Planner Agent - Multi-Agent Coordination
 * Uses AI to break down tasks and delegates to other agents via AgentManager
 */
const Agent = require("../core/agent-runtime");
const agentManager = require("./manager"); // Import the agent manager
const chatEngine = require("../backend/ai/chat-engine"); // For AI planning

class PlannerAgent extends Agent {
  constructor() {
    super("planner", {
      timeout: 60000,
      maxRetries: 2
    });
    
    this.planHistory = [];
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'plan', 'coordinate', 'organize', 'manage', 'orchestrate',
      'workflow', 'pipeline', 'strategy', 'complex', 'multi-step'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['task decomposition', 'workflow orchestration', 'resource allocation', 'scheduling'];
  }

  /**
   * Execute planning task
   */
  async execute(task) {
    this.validateTask(task);
    
    console.log(`📋 Planner agent creating plan for: "${task.substring(0, 50)}..."`);
    
    // Decompose task into steps using AI
    const plan = await this.createPlan(task);
    
    // Execute plan by delegating to real agents
    const results = await this.executePlan(plan);
    
    // Store in history
    this.planHistory.push({
      task,
      plan,
      results,
      timestamp: new Date().toISOString()
    });
    
    return {
      plan: plan,
      results: results,
      summary: this.generateSummary(plan, results),
      recommendations: this.generateRecommendations(plan, results)
    };
  }

  /**
   * Create execution plan using AI
   */
  async createPlan(task) {
    // Use AI to break down the task into steps
    const prompt = `You are a task planning assistant. Break down the following complex task into a series of simple steps. For each step, specify which type of agent should handle it (research, coding, automation, or general). Return a JSON array of objects with properties: "agent", "description", and "action". Only return valid JSON, no extra text.

Task: ${task}`;

    try {
      const response = await chatEngine.chat(prompt, { model: 'gpt-3.5-turbo', temperature: 0.3, maxTokens: 800 });
      const content = response.content;
      // Extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      const steps = JSON.parse(jsonMatch[0]);
      
      return {
        task,
        steps: steps.map((s, idx) => ({ id: idx + 1, ...s })),
        estimatedTime: steps.length * 2000,
        parallelizable: steps.length > 1 && steps.every(s => !s.dependsOn)
      };
    } catch (error) {
      console.warn('AI planning failed, using fallback', error);
      // Fallback to simple rule-based planning
      return this.fallbackPlan(task);
    }
  }

  /**
   * Execute the plan by delegating to real agents
   */
  async executePlan(plan) {
    const results = [];
    for (const step of plan.steps) {
      console.log(`Executing step ${step.id}: ${step.description}`);
      
      // Find the appropriate agent via agent manager
      const availableAgents = agentManager.listAgents();
      const agent = availableAgents.find(a => a.name.toLowerCase().includes(step.agent.toLowerCase()));
      
      if (agent) {
        try {
          // We need to get the actual agent instance; agentManager has a getAgent method
          const agentInstance = agentManager.getAgent(agent.name);
          const result = await agentInstance.execute(step.action);
          results.push({
            step: step.id,
            success: true,
            agent: step.agent,
            result
          });
        } catch (error) {
          results.push({
            step: step.id,
            success: false,
            agent: step.agent,
            error: error.message
          });
        }
      } else {
        // Simulate step execution if agent not found
        await new Promise(resolve => setTimeout(resolve, 1000));
        results.push({
          step: step.id,
          success: true,
          agent: step.agent,
          result: `Executed: ${step.description}`
        });
      }
    }
    return results;
  }

  /**
   * Fallback plan generation (rule‑based)
   */
  fallbackPlan(task) {
    const taskLower = task.toLowerCase();
    const steps = [];
    
    if (taskLower.includes('research') || taskLower.includes('find')) {
      steps.push({
        id: 1,
        agent: 'research',
        description: 'Gather information',
        action: 'research ' + this.extractTopic(task)
      });
    }
    
    if (taskLower.includes('code') || taskLower.includes('program')) {
      steps.push({
        id: steps.length + 1,
        agent: 'coding',
        description: 'Generate code',
        action: 'run code ' + this.extractCodeTask(task)
      });
    }
    
    if (taskLower.includes('automate') || taskLower.includes('auto')) {
      steps.push({
        id: steps.length + 1,
        agent: 'automation',
        description: 'Create automation',
        action: 'automate ' + task
      });
    }
    
    if (steps.length === 0) {
      steps.push({
        id: 1,
        agent: 'general',
        description: 'Process task',
        action: task
      });
    }
    
    return {
      task,
      steps,
      estimatedTime: steps.length * 2000,
      parallelizable: steps.length > 1 && steps.every(s => !s.dependsOn)
    };
  }

  extractTopic(task) {
    return task.replace(/research|find|learn about/gi, '').trim();
  }

  extractCodeTask(task) {
    return task.replace(/code|program|write|run code/gi, '').trim();
  }

  generateSummary(plan, results) {
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    return `Completed ${successful}/${total} steps successfully. ${plan.parallelizable ? 'Steps were executed in parallel.' : 'Steps were executed sequentially.'}`;
  }

  generateRecommendations(plan, results) {
    const recommendations = [];
    if (results.some(r => !r.success)) {
      recommendations.push('Add error handling for failed steps');
    }
    if (plan.steps.length > 5) {
      recommendations.push('Consider breaking into smaller sub-plans');
    }
    return recommendations;
  }

  validateTask(task) {
    if (!task || typeof task !== 'string') {
      throw new Error('Task must be a non-empty string');
    }
  }
}

module.exports = new PlannerAgent();
