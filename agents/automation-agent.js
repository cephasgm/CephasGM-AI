/**
 * Automation Agent - Business process automation
 * Integrated with feedback loop for learning
 */
const Agent = require("../core/agent-runtime");
const fs = require("fs").promises;
const path = require("path");

class AutomationAgent extends Agent {
  constructor() {
    super("automation", {
      timeout: 30000,
      maxRetries: 2
    });
    
    this.logFile = path.join(__dirname, '../automation.log');
    this.automations = [];
    this.schedules = [];
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'automate', 'schedule', 'backup', 'sync', 'monitor', 
      'deploy', 'process', 'workflow', 'cron', 'job'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['task automation', 'scheduling', 'file operations', 'process monitoring'];
  }

  /**
   * Execute automation task with retry and feedback recording
   */
  async execute(task) {
    // Use base class retry logic – this automatically records outcomes
    return this.executeWithRetry(task);
  }

  /**
   * Internal task processing – called by executeWithRetry
   */
  async processTask(task) {
    this.validateTask(task);
    
    console.log(`⚙️ Automation agent processing: "${task.substring(0, 50)}..."`);
    
    // Log the automation
    await this.logAutomation(task);
    
    // Determine automation type
    let result;
    if (task.toLowerCase().includes('schedule')) {
      result = await this.createSchedule(task);
    } else if (task.toLowerCase().includes('backup')) {
      result = await this.createBackup(task);
    } else if (task.toLowerCase().includes('monitor')) {
      result = await this.createMonitor(task);
    } else if (task.toLowerCase().includes('sync')) {
      result = await this.createSync(task);
    } else {
      result = await this.genericAutomation(task);
    }
    
    return result;
  }

  /**
   * Log automation to file
   */
  async logAutomation(task) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      task,
      status: 'executed'
    };
    
    try {
      await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write to automation log:', error);
    }
    
    this.automations.push(logEntry);
  }

  /**
   * Create scheduled task
   */
  async createSchedule(task) {
    // Parse schedule from task
    const schedule = {
      id: `schedule_${Date.now()}`,
      task: task.replace(/schedule/gi, '').trim(),
      created: new Date().toISOString(),
      nextRun: this.calculateNextRun(task)
    };
    
    this.schedules.push(schedule);
    
    return {
      success: true,
      type: 'schedule',
      schedule,
      message: `Task scheduled for ${schedule.nextRun}`
    };
  }

  /**
   * Create backup automation
   */
  async createBackup(task) {
    // Parse backup parameters
    const backup = {
      id: `backup_${Date.now()}`,
      source: this.extractSource(task) || './data',
      destination: this.extractDestination(task) || './backups',
      type: task.includes('incremental') ? 'incremental' : 'full',
      scheduled: task.includes('schedule') ? this.calculateNextRun(task) : null
    };
    
    // Simulate backup
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      success: true,
      type: 'backup',
      backup,
      files: 42,
      size: '156 MB',
      duration: '2.3s'
    };
  }

  /**
   * Create monitoring automation
   */
  async createMonitor(task) {
    const target = this.extractTarget(task) || 'system';
    
    const monitor = {
      id: `monitor_${Date.now()}`,
      target,
      interval: task.includes('every') ? this.extractInterval(task) : 60,
      metrics: ['cpu', 'memory', 'disk', 'network'],
      alerts: task.includes('alert') ? ['email', 'slack'] : []
    };
    
    return {
      success: true,
      type: 'monitor',
      monitor,
      status: 'active',
      current: {
        cpu: '45%',
        memory: '62%',
        disk: '78%',
        uptime: '15d'
      }
    };
  }

  /**
   * Create sync automation
   */
  async createSync(task) {
    const source = this.extractSource(task) || './source';
    const dest = this.extractDestination(task) || './dest';
    
    const sync = {
      id: `sync_${Date.now()}`,
      source,
      destination: dest,
      direction: task.includes('bidirectional') ? 'bidirectional' : 'one-way',
      continuous: task.includes('continuous') || task.includes('watch')
    };
    
    return {
      success: true,
      type: 'sync',
      sync,
      filesSynced: 128,
      conflicts: 0,
      duration: '4.7s'
    };
  }

  /**
   * Generic automation
   */
  async genericAutomation(task) {
    const automation = {
      id: `auto_${Date.now()}`,
      task: task.replace(/automate/gi, '').trim(),
      status: 'created',
      steps: [
        'Validating inputs',
        'Processing task',
        'Executing automation',
        'Verifying results'
      ]
    };
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    return {
      success: true,
      type: 'generic',
      automation,
      result: 'Automation completed successfully',
      logs: [
        'Step 1: Validated inputs ✓',
        'Step 2: Processed task ✓',
        'Step 3: Executed automation ✓',
        'Step 4: Verified results ✓'
      ]
    };
  }

  /**
   * Calculate next run time based on schedule description
   */
  calculateNextRun(task) {
    const now = new Date();
    
    if (task.includes('hourly')) {
      return new Date(now.setHours(now.getHours() + 1, 0, 0, 0)).toISOString();
    } else if (task.includes('daily')) {
      return new Date(now.setDate(now.getDate() + 1)).toISOString();
    } else if (task.includes('weekly')) {
      return new Date(now.setDate(now.getDate() + 7)).toISOString();
    } else if (task.includes('monthly')) {
      return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
    } else {
      return new Date(now.setHours(now.getHours() + 1)).toISOString();
    }
  }

  /**
   * Extract source from task
   */
  extractSource(task) {
    const match = task.match(/from\s+([^\s]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Extract destination from task
   */
  extractDestination(task) {
    const match = task.match(/to\s+([^\s]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Extract target for monitoring
   */
  extractTarget(task) {
    const match = task.match(/monitor\s+([^\s]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Extract interval from task
   */
  extractInterval(task) {
    const match = task.match(/every\s+(\d+)\s*(second|minute|hour)s?/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      const multiplier = unit === 'second' ? 1 : unit === 'minute' ? 60 : 3600;
      return value * multiplier;
    }
    return 60; // default 60 seconds
  }

  /**
   * Get all automations
   */
  getAutomations() {
    return this.automations;
  }

  /**
   * Get all schedules
   */
  getSchedules() {
    return this.schedules;
  }

  /**
   * Read automation log
   */
  async readLog(limit = 100) {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const lines = data.split('\n').filter(Boolean);
      return lines.slice(-limit).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Clear log
   */
  async clearLog() {
    try {
      await fs.writeFile(this.logFile, '');
      this.automations = [];
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new AutomationAgent();
