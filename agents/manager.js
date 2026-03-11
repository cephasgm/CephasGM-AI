/**
 * Multi-Agent Manager - Routes tasks to appropriate agents
 */
const ResearchAgent = require('./research-agent');
const CodingAgent = require('./coding-agent');
const AutomationAgent = require('./automation-agent');

class AgentManager {
  constructor() {
    this.agents = [
      ResearchAgent,
      CodingAgent,
      AutomationAgent
    ];
    
    this.agentRegistry = new Map();
    this.initializeAgents();
  }

  /**
   * Initialize agent registry
   */
  initializeAgents() {
    this.agents.forEach(agent => {
      this.agentRegistry.set(agent.name || agent.constructor.name, agent);
    });
    console.log(`Agent manager initialized with ${this.agents.length} agents`);
  }

  /**
   * Route task to appropriate agent
   */
  async route(task, params = {}) {
    try {
      if (!task || typeof task !== 'string') {
        throw new Error('Task must be a non-empty string');
      }

      console.log(`Routing task: "${task.substring(0, 50)}..."`);

      // Find agent that can handle the task
      for (const agent of this.agents) {
        if (agent.canHandle && agent.canHandle(task)) {
          console.log(`Task routed to ${agent.name || agent.constructor.name}`);
          
          const startTime = Date.now();
          const result = await agent.execute(task, params);
          const executionTime = Date.now() - startTime;
          
          return {
            success: true,
            agent: agent.name || agent.constructor.name,
            task: task,
            result: result,
            executionTime: `${executionTime}ms`,
            timestamp: new Date().toISOString()
          };
        }
      }

      // No agent found
      return {
        success: false,
        error: 'No agent available to handle this task',
        task: task,
        availableAgents: this.agents.map(a => a.name || a.constructor.name)
      };

    } catch (error) {
      console.error('Agent manager error:', error);
      return {
        success: false,
        error: error.message,
        task: task
      };
    }
  }

  /**
   * Get specific agent by name
   */
  getAgent(name) {
    return this.agentRegistry.get(name);
  }

  /**
   * List all available agents
   */
  listAgents() {
    return this.agents.map(agent => ({
      name: agent.name || agent.constructor.name,
      capabilities: agent.getCapabilities ? agent.getCapabilities() : ['unknown']
    }));
  }

  /**
   * Register a new agent
   */
  registerAgent(agent) {
    if (!agent.canHandle || !agent.execute) {
      throw new Error('Agent must implement canHandle() and execute() methods');
    }
    
    this.agents.push(agent);
    this.agentRegistry.set(agent.name || agent.constructor.name, agent);
    
    console.log(`New agent registered: ${agent.name || agent.constructor.name}`);
  }
}

module.exports = new AgentManager();
