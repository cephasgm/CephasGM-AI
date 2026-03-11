/**
 * Task Queue - Priority-based task management
 * Supports multiple queues, priorities, and persistence
 */
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    
    this.queues = {
      high: [],
      normal: [],
      low: []
    };
    
    this.taskMap = new Map(); // Quick lookup by ID
    this.completedTasks = [];
    this.failedTasks = [];
    
    this.priorityLevels = ['high', 'normal', 'low'];
    this.persistPath = path.join(__dirname, '../task-queue.json');
    
    // Load persisted queue
    this.load();
  }

  /**
   * Add task to queue
   */
  add(task) {
    const priority = task.priority || 'normal';
    
    if (!this.priorityLevels.includes(priority)) {
      throw new Error(`Invalid priority: ${priority}`);
    }

    const taskItem = {
      ...task,
      queuedAt: new Date().toISOString(),
      priority
    };

    this.queues[priority].push(taskItem);
    this.taskMap.set(task.id, taskItem);
    
    this.emit('taskAdded', taskItem);
    this.persist();

    return task.id;
  }

  /**
   * Get next task from queue (round-robin with priority)
   */
  next() {
    // Check high priority first
    if (this.queues.high.length > 0) {
      return this.dequeue('high');
    }
    
    // Then normal
    if (this.queues.normal.length > 0) {
      return this.dequeue('normal');
    }
    
    // Then low
    if (this.queues.low.length > 0) {
      return this.dequeue('low');
    }
    
    return null;
  }

  /**
   * Dequeue task from specific priority
   */
  dequeue(priority) {
    const task = this.queues[priority].shift();
    task.dequeuedAt = new Date().toISOString();
    return task;
  }

  /**
   * Get task by ID
   */
  get(taskId) {
    return this.taskMap.get(taskId);
  }

  /**
   * Get task status
   */
  getStatus(taskId) {
    const task = this.taskMap.get(taskId);
    
    if (!task) {
      // Check completed tasks
      const completed = this.completedTasks.find(t => t.id === taskId);
      if (completed) return { ...completed, status: 'completed' };
      
      const failed = this.failedTasks.find(t => t.id === taskId);
      if (failed) return { ...failed, status: 'failed' };
      
      return null;
    }

    return {
      ...task,
      status: 'queued'
    };
  }

  /**
   * Mark task as completed
   */
  complete(taskId, result) {
    const task = this.taskMap.get(taskId);
    
    if (task) {
      task.completedAt = new Date().toISOString();
      task.result = result;
      this.completedTasks.push(task);
      this.taskMap.delete(taskId);
      
      this.emit('taskCompleted', task);
      this.persist();
    }
  }

  /**
   * Mark task as failed
   */
  fail(taskId, error) {
    const task = this.taskMap.get(taskId);
    
    if (task) {
      task.failedAt = new Date().toISOString();
      task.error = error;
      this.failedTasks.push(task);
      this.taskMap.delete(taskId);
      
      this.emit('taskFailed', task);
      this.persist();
    }
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(olderThan = 24 * 60 * 60 * 1000) { // Default 24 hours
    const cutoff = Date.now() - olderThan;
    
    this.completedTasks = this.completedTasks.filter(task => 
      new Date(task.completedAt).getTime() > cutoff
    );
    
    this.failedTasks = this.failedTasks.filter(task => 
      new Date(task.failedAt).getTime() > cutoff
    );
    
    this.persist();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueSizes: {
        high: this.queues.high.length,
        normal: this.queues.normal.length,
        low: this.queues.low.length
      },
      totalQueued: this.taskMap.size,
      completedToday: this.completedTasks.length,
      failedToday: this.failedTasks.length,
      oldestTask: this.getOldestTask()
    };
  }

  /**
   * Get oldest queued task
   */
  getOldestTask() {
    const allTasks = [
      ...this.queues.high,
      ...this.queues.normal,
      ...this.queues.low
    ];
    
    if (allTasks.length === 0) return null;
    
    return allTasks.reduce((oldest, task) => 
      new Date(task.queuedAt) < new Date(oldest.queuedAt) ? task : oldest
    );
  }

  /**
   * Get queue size
   */
  size() {
    return this.queues.high.length + this.queues.normal.length + this.queues.low.length;
  }

  /**
   * Clear all queues
   */
  clear() {
    this.queues = {
      high: [],
      normal: [],
      low: []
    };
    this.taskMap.clear();
    
    this.emit('cleared');
    this.persist();
  }

  /**
   * Persist queue to disk
   */
  async persist() {
    try {
      const data = {
        queues: {
          high: this.queues.high,
          normal: this.queues.normal,
          low: this.queues.low
        },
        completedTasks: this.completedTasks.slice(-100), // Keep last 100
        failedTasks: this.failedTasks.slice(-100)
      };
      
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to persist queue:', error);
    }
  }

  /**
   * Load queue from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.persistPath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.queues = parsed.queues || this.queues;
      this.completedTasks = parsed.completedTasks || [];
      this.failedTasks = parsed.failedTasks || [];
      
      // Rebuild task map
      Object.values(this.queues).forEach(queue => {
        queue.forEach(task => {
          this.taskMap.set(task.id, task);
        });
      });
      
      console.log(`📦 Loaded queue with ${this.size()} pending tasks`);
      
    } catch (error) {
      // No saved queue, start fresh
    }
  }

  /**
   * Requeue failed tasks
   */
  requeueFailed(maxAge = 3600000) { // Default 1 hour
    const now = Date.now();
    const toRequeue = this.failedTasks.filter(task => 
      now - new Date(task.failedAt).getTime() < maxAge
    );
    
    toRequeue.forEach(task => {
      task.attempts = (task.attempts || 0) + 1;
      task.status = 'queued';
      delete task.failedAt;
      delete task.error;
      
      this.add(task);
    });
    
    // Remove from failed list
    this.failedTasks = this.failedTasks.filter(task => 
      now - new Date(task.failedAt).getTime() >= maxAge
    );
    
    return toRequeue.length;
  }
}

module.exports = new TaskQueue();
