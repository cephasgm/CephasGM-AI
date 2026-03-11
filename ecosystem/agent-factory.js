/**
 * Agent Factory - Self-Building Agents
 * Creates and configures agents dynamically
 */
const ResearchLab = require("../agents/research-lab");
const SoftwareFactory = require("../agents/software-factory");
const AutonomousAgent = require("../agents/autonomous-agent");
const EventEmitter = require('events');

class AgentFactory extends EventEmitter {
  constructor() {
    super();
    
    this.agentRegistry = new Map();
    this.templates = new Map();
    this.builtAgents = new Map();
    
    this.registerDefaultAgents();
    this.loadTemplates();
  }

  /**
   * Register default agent types
   */
  registerDefaultAgents() {
    this.registerAgent('research', ResearchLab);
    this.registerAgent('software', SoftwareFactory);
    this.registerAgent('autonomous', AutonomousAgent);
    
    console.log(`📦 Registered ${this.agentRegistry.size} agent types`);
  }

  /**
   * Register an agent type
   */
  registerAgent(type, constructor) {
    this.agentRegistry.set(type, {
      constructor,
      createdAt: new Date().toISOString()
    });
    
    this.emit('agentRegistered', { type });
  }

  /**
   * Load agent templates
   */
  loadTemplates() {
    this.templates.set('research', {
      capabilities: ['research', 'search', 'find', 'analyze'],
      defaultConfig: { timeout: 30000, maxSources: 5 }
    });

    this.templates.set('software', {
      capabilities: ['code', 'build', 'develop', 'program'],
      defaultConfig: { language: 'javascript', timeout: 10000 }
    });

    this.templates.set('autonomous', {
      capabilities: ['general', 'process', 'handle', 'manage'],
      defaultConfig: { learningRate: 0.1, adaptability: 0.5 }
    });
  }

  /**
   * Build an agent of specified type
   */
  build(type, config = {}) {
    console.log(`🔧 Building agent of type: ${type}`);

    try {
      const agentInfo = this.agentRegistry.get(type);
      
      if (!agentInfo) {
        throw new Error(`Unknown agent type: ${type}`);
      }

      // Get template
      const template = this.templates.get(type) || {
        capabilities: [],
        defaultConfig: {}
      };

      // Merge configurations
      const agentConfig = {
        ...template.defaultConfig,
        ...config,
        builtAt: new Date().toISOString()
      };

      // Instantiate agent
      const AgentClass = agentInfo.constructor;
      const agent = new AgentClass(agentConfig);

      // Enhance agent with factory features
      agent.type = type;
      agent.capabilities = template.capabilities;
      agent.config = agentConfig;

      // Add self-building capabilities
      agent.upgrade = async (newCapabilities) => {
        return this.upgradeAgent(agent, newCapabilities);
      };

      agent.clone = async () => {
        return this.build(type, config);
      };

      // Store in built agents registry
      const agentId = agent.id || `agent_${Date.now()}`;
      this.builtAgents.set(agentId, agent);

      this.emit('agentBuilt', { type, agentId });

      console.log(`✅ Built ${type} agent successfully`);

      return agent;

    } catch (error) {
      console.error(`Failed to build agent ${type}:`, error);
      
      // Return autonomous agent as fallback
      if (type !== 'autonomous') {
        console.log('⚠️ Falling back to autonomous agent');
        return this.build('autonomous', config);
      }
      
      throw error;
    }
  }

  /**
   * Build multiple agents
   */
  buildMany(types) {
    return types.map(type => this.build(type));
  }

  /**
   * Upgrade an agent with new capabilities
   */
  async upgradeAgent(agent, newCapabilities) {
    console.log(`⬆️ Upgrading agent ${agent.type} with new capabilities`);

    const upgrade = {
      timestamp: new Date().toISOString(),
      oldCapabilities: agent.capabilities || [],
      newCapabilities,
      status: 'upgraded'
    };

    // Add new capabilities
    agent.capabilities = [...(agent.capabilities || []), ...newCapabilities];
    agent.upgradeHistory = agent.upgradeHistory || [];
    agent.upgradeHistory.push(upgrade);

    this.emit('agentUpgraded', {
      agentId: agent.id,
      upgrade
    });

    return upgrade;
  }

  /**
   * Create a specialized agent based on requirements
   */
  async createSpecialized(requirements) {
    console.log('🎯 Creating specialized agent for requirements:', requirements);

    // Analyze requirements
    const types = [];
    
    if (requirements.includes('research') || requirements.includes('search')) {
      types.push('research');
    }
    
    if (requirements.includes('code') || requirements.includes('develop')) {
      types.push('software');
    }
    
    if (types.length === 0) {
      types.push('autonomous');
    }

    // Build primary agent
    const primaryType = types[0];
    const agent = this.build(primaryType, {
      specializedFor: requirements,
      secondaryTypes: types.slice(1)
    });

    // Add specialized methods
    agent.specialize = async (task) => {
      if (types.length > 1) {
        // Route to appropriate sub-agent
        const subAgent = this.build(types[1]);
        return subAgent.execute(task);
      }
      return agent.execute(task);
    };

    return agent;
  }

  /**
   * Get agent template
   */
  getTemplate(type) {
    return this.templates.get(type);
  }

  /**
   * List available agent types
   */
  listTypes() {
    return Array.from(this.agentRegistry.keys());
  }

  /**
   * Get factory statistics
   */
  getStats() {
    return {
      registeredTypes: this.agentRegistry.size,
      builtAgents: this.builtAgents.size,
      templates: this.templates.size,
      types: this.listTypes()
    };
  }

  /**
   * Destroy an agent
   */
  destroyAgent(agentId) {
    return this.builtAgents.delete(agentId);
  }
}

module.exports = new AgentFactory();
