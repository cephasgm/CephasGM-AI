/**
 * AI Orchestrator - Central coordination for all AI tasks
 * Manages workflow execution, resource allocation, and task lifecycle
 */
const EventEmitter = require('events');
const queue = require("./task-queue");
const os = require('os');

class Orchestrator extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.workflows = new Map();
    this.metrics = {
      tasksProcessed: 0,
      workflowsCompleted: 0,
      startTime: Date.now(),
      activeWorkflows: 0
    };
    
    this.resourceMonitor = {
      cpu: 0,
      memory: 0,
      lastCheck: Date.now()
    };
  }

  /**
   * Submit a task to the orchestrator
   */
  async submit(task, options = {}) {
    const taskId = this.generateTaskId();
    
    const taskItem = {
      id: taskId,
      ...task,
      priority: options.priority || 'normal',
      submittedAt: new Date().toISOString(),
      status: 'queued',
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      tags: options.tags || []
    };

    queue.add(taskItem);
    
    console.log(`📥 [${taskId}] Task submitted: ${task.type || 'unknown'}`);
    this.emit('taskSubmitted', taskItem);

    // Start orchestrator if not running
    if (!this.running) {
      this.run();
    }

    return {
      taskId,
      status: 'queued',
      position: queue.size()
    };
  }

  /**
   * Submit a workflow (sequence of tasks)
   */
  async submitWorkflow(workflow) {
    const workflowId = this.generateWorkflowId();
    
    const workflowItem = {
      id: workflowId,
      ...workflow,
      tasks: workflow.tasks.map((task, index) => ({
        ...task,
        workflowId,
        step: index + 1,
        totalSteps: workflow.tasks.length,
        status: 'pending'
      })),
      submittedAt: new Date().toISOString(),
      status: 'pending',
      currentStep: 0
    };

    this.workflows.set(workflowId, workflowItem);
    this.metrics.activeWorkflows++;

    // Submit first task
    await this.submit(workflowItem.tasks[0], {
      priority: 'high',
      tags: [`workflow:${workflowId}`]
    });

    console.log(`📋 [${workflowId}] Workflow submitted with ${workflow.tasks.length} tasks`);
    this.emit('workflowSubmitted', workflowItem);

    return {
      workflowId,
      taskCount: workflow.tasks.length
    };
  }

  /**
   * Main orchestrator loop
   */
  async run() {
    if (this.running) return;
    
    this.running = true;
    console.log('🚀 Orchestrator started');

    while (this.running) {
      try {
        // Monitor system resources
        this.checkResources();

        // Get next task from queue
        const task = queue.next();
        
        if (task) {
          await this.processTask(task);
        } else {
          // No tasks, sleep briefly
          await this.sleep(100);
        }
      } catch (error) {
        console.error('Orchestrator error:', error);
        await this.sleep(1000);
      }
    }
  }

  /**
   * Process a single task
   */
  async processTask(task) {
    task.status = 'processing';
    task.startedAt = new Date().toISOString();
    
    console.log(`⚙️ [${task.id}] Processing: ${task.type || 'task'}`);
    this.emit('taskStarted', task);

    try {
      // Route to appropriate handler
      let result;
      
      switch (task.type) {
        case 'research':
          const research = require('../agents/research-pipeline');
          result = await research.run(task.payload);
          break;
          
        case 'code':
          const coding = require('../agents/coding-studio');
          result = await coding.run(task.payload);
          break;
          
        case 'employee':
          const employees = require('../agents/employee-manager');
          result = await employees.runEmployee(task);
          break;
          
        case 'inference':
          const gateway = require('../cloud/ai-gateway');
          result = await gateway.request(task.payload);
          break;
          
        default:
          result = { error: `Unknown task type: ${task.type}` };
      }

      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      task.result = result;
      
      this.metrics.tasksProcessed++;
      
      console.log(`✅ [${task.id}] Task completed`);
      this.emit('taskCompleted', task);

      // Check if this task is part of a workflow
      if (task.tags) {
        const workflowTag = task.tags.find(t => t.startsWith('workflow:'));
        if (workflowTag) {
          await this.advanceWorkflow(workflowTag.replace('workflow:', ''), task);
        }
      }

    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.attempts++;
      
      console.error(`❌ [${task.id}] Task failed:`, error.message);

      // Retry logic
      if (task.attempts < task.maxAttempts) {
        console.log(`🔄 [${task.id}] Retrying (${task.attempts}/${task.maxAttempts})...`);
        task.status = 'queued';
        queue.add(task);
      } else {
        this.emit('taskFailed', task);
      }
    }
  }

  /**
   * Advance workflow to next step
   */
  async advanceWorkflow(workflowId, completedTask) {
    const workflow = this.workflows.get(workflowId);
    
    if (!workflow) return;

    workflow.currentStep++;
    
    // Store result
    if (!workflow.results) workflow.results = [];
    workflow.results.push({
      step: workflow.currentStep,
      task: completedTask.type,
      result: completedTask.result
    });

    // Check if workflow is complete
    if (workflow.currentStep >= workflow.tasks.length) {
      workflow.status = 'completed';
      workflow.completedAt = new Date().toISOString();
      this.metrics.workflowsCompleted++;
      this.metrics.activeWorkflows--;
      
      console.log(`🎉 [${workflowId}] Workflow completed`);
      this.emit('workflowCompleted', workflow);
      return;
    }

    // Submit next task
    const nextTask = workflow.tasks[workflow.currentStep];
    nextTask.status = 'queued';
    
    await this.submit(nextTask, {
      priority: 'high',
      tags: [`workflow:${workflowId}`]
    });

    console.log(`⏩ [${workflowId}] Advanced to step ${workflow.currentStep + 1}/${workflow.tasks.length}`);
  }

  /**
   * Check system resources
   */
  checkResources() {
    this.resourceMonitor.cpu = os.loadavg()[0];
    this.resourceMonitor.memory = 1 - (os.freemem() / os.totalmem());
    this.resourceMonitor.lastCheck = Date.now();

    if (this.resourceMonitor.memory > 0.9) {
      console.warn('⚠️ High memory usage detected');
      this.emit('resourceWarning', 'memory', this.resourceMonitor.memory);
    }

    if (this.resourceMonitor.cpu > 4) {
      console.warn('⚠️ High CPU load detected');
      this.emit('resourceWarning', 'cpu', this.resourceMonitor.cpu);
    }
  }

  /**
   * Get task status
   */
  getStatus(taskId) {
    return queue.getStatus(taskId);
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId) {
    return this.workflows.get(workflowId);
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSize: queue.size(),
      activeWorkflows: this.metrics.activeWorkflows,
      uptime: Date.now() - this.metrics.startTime,
      resources: this.resourceMonitor
    };
  }

  /**
   * Stop orchestrator
   */
  stop() {
    this.running = false;
    console.log('🛑 Orchestrator stopped');
    this.emit('stopped');
  }

  /**
   * Generate task ID
   */
  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate workflow ID
   */
  generateWorkflowId() {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new Orchestrator();
