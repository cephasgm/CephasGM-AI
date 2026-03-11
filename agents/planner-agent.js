/**
 * Planner Agent - Multi-Agent Coordination
 * Breaks down complex tasks into subtasks and coordinates other agents
 */
const Agent = require("../core/agent-runtime");

class PlannerAgent extends Agent {
  constructor() {
    super("planner", {
      timeout: 60000,
      maxRetries: 2
    });
    
    this.subAgents = [];
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
    
    // Decompose task into steps
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
   * Create execution plan
   */
  async createPlan(task) {
    const taskLower = task.toLowerCase();
    const steps = [];
    
    // Parse task and create steps
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
    
    // If no specific steps detected, create generic plan
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
