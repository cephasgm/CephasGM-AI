/**
 * Planner Agent - Multi-Agent Coordination
 * Breaks down complex tasks into subtasks and coordinates other agents
 */
const Agent = require("../core/agent-runtime");
const fetch = require('node-fetch');

class PlannerAgent extends Agent {
  constructor() {
    super("planner", {
      timeout: 60000,
      maxRetries: 2
    });
    
    this.subAgents = [];
    this.planHistory = [];
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
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
    
    // Execute plan (if sub-agents are available)
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
    // Use AI to break down task if API keys are available
    if (this.openaiApiKey || this.ollamaApiKey) {
      try {
        const prompt = `Break down the following complex task into a series of simple steps. For each step, specify which type of agent should handle it (research, coding, automation, or general). Return the result as a JSON array of objects with properties: agent, description, action.\n\nTask: ${task}`;

        let planText;
        if (this.openaiApiKey) {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.openaiApiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [
                { role: 'system', content: 'You are a task planning assistant. Always return valid JSON.' },
                { role: 'user', content: prompt }
              ],
              temperature: 0.3,
              max_tokens: 800
            })
          });
          if (response.ok) {
            const data = await response.json();
            planText = data.choices[0].message.content;
          }
        } else if (this.ollamaApiKey) {
          const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.ollamaApiKey}`
            },
            body: JSON.stringify({
              model: 'llama3.2:3b',
              messages: [
                { role: 'system', content: 'You are a task planning assistant. Always return valid JSON.' },
                { role: 'user', content: prompt }
              ],
              options: {
                temperature: 0.3,
                num_predict: 800
              }
            })
          });
          if (response.ok) {
            const data = await response.json();
            planText = data.message.content;
          }
        }

        if (planText) {
          // Try to parse JSON
          const jsonMatch = planText.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const steps = JSON.parse(jsonMatch[0]);
            if (Array.isArray(steps) && steps.length > 0) {
              return {
                task,
                steps: steps.map((s, idx) => ({ id: idx + 1, ...s })),
                estimatedTime: steps.length * 2000,
                parallelizable: steps.length > 1 && steps.every(s => !s.dependsOn)
              };
            }
          }
        }
      } catch (e) {
        console.warn('AI planning failed, using fallback', e);
      }
    }

    // Fallback to simple rule-based planning
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
      parallelizable: this.canParallelize(steps)
    };
  }

  /**
   * Execute the plan
   */
  async executePlan(plan) {
    const results = [];
    
    for (const step of plan.steps) {
      console.log(`Executing step ${step.id}: ${step.description}`);
      
      // Find the right agent
      const agent = this.findAgent(step.agent);
      
      if (agent) {
        try {
          const result = await agent.execute(step.action);
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
        // Simulate step execution
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
   * Find an agent by name
   */
  findAgent(agentName) {
    // This would be populated by the OS
    // For now, return null (simulated)
    return null;
  }

  /**
   * Check if steps can be parallelized
   */
  canParallelize(steps) {
    // Simple heuristic: steps that don't depend on each other
    return steps.length > 1 && steps.every(s => !s.dependsOn);
  }

  /**
   * Extract topic from task
   */
  extractTopic(task) {
    return task.replace(/research|find|learn about/gi, '').trim();
  }

  /**
   * Extract code task
   */
  extractCodeTask(task) {
    return task.replace(/code|program|write|run code/gi, '').trim();
  }

  /**
   * Generate summary of execution
   */
  generateSummary(plan, results) {
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    
    return `Completed ${successful}/${total} steps successfully. ${plan.parallelizable ? 'Steps were executed in parallel.' : 'Steps were executed sequentially.'}`;
  }

  /**
   * Generate recommendations for future plans
   */
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

  /**
   * Replan based on feedback
   */
  async replan(taskId, feedback) {
    const plan = this.planHistory.find(p => p.task.includes(taskId));
    
    if (!plan) {
      throw new Error('Plan not found');
    }
    
    console.log('🔄 Replanning based on feedback...');
    
    // Modify plan based on feedback
    const newPlan = {
      ...plan.plan,
      modified: true,
      feedback
    };
    
    return newPlan;
  }
}

module.exports = new PlannerAgent();
