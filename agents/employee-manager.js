/**
 * Autonomous AI Employees Manager
 * Manages specialized AI workers for different tasks
 */
const EventEmitter = require('events');
const research = require("./research-pipeline");
const coding = require("./coding-studio");
const orchestrator = require("../platform/orchestrator");

class EmployeeManager extends EventEmitter {
  constructor() {
    super();
    
    this.employees = new Map();
    this.teams = new Map();
    this.assignments = new Map();
    
    // Register employee types
    this.registerEmployeeType('research', research);
    this.registerEmployeeType('coding', coding);
    
    // Create default teams
    this.createTeam('research-team', ['research']);
    this.createTeam('development-team', ['coding']);
    this.createTeam('full-stack-team', ['research', 'coding']);
    
    console.log(`👥 Employee manager initialized with ${this.employees.size} employee types`);
  }

  /**
   * Register an employee type
   */
  registerEmployeeType(type, implementation) {
    this.employees.set(type, {
      type,
      implementation,
      status: 'available',
      metrics: {
        tasksCompleted: 0,
        totalExecutionTime: 0,
        successRate: 1.0
      }
    });
    
    console.log(`✅ Registered employee type: ${type}`);
  }

  /**
   * Create a team
   */
  createTeam(name, employeeTypes) {
    const team = {
      name,
      employees: employeeTypes,
      createdAt: new Date().toISOString(),
      metrics: {
        tasksAssigned: 0,
        tasksCompleted: 0
      }
    };
    
    this.teams.set(name, team);
    console.log(`👥 Created team: ${name} with ${employeeTypes.length} employee types`);
    
    return team;
  }

  /**
   * Run an employee task
   */
  async runEmployee(task) {
    const { type, payload, options = {} } = task;
    
    console.log(`👤 Running employee task: ${type}`);

    // Get employee implementation
    const employee = this.employees.get(type);
    
    if (!employee) {
      return {
        success: false,
        error: `Employee type '${type}' not found`,
        availableTypes: Array.from(this.employees.keys())
      };
    }

    const startTime = Date.now();

    try {
      let result;
      
      // Route to appropriate employee
      switch (type) {
        case 'research':
          result = await research.run(payload);
          break;
          
        case 'coding':
          result = await coding.run(payload);
          break;
          
        default:
          // Try to use implementation directly
          if (employee.implementation && employee.implementation.run) {
            result = await employee.implementation.run(payload);
          } else {
            throw new Error(`Employee ${type} has no run method`);
          }
      }

      // Update metrics
      employee.metrics.tasksCompleted++;
      employee.metrics.totalExecutionTime += Date.now() - startTime;

      return {
        success: true,
        employee: type,
        result,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error(`Employee ${type} failed:`, error);
      
      return {
        success: false,
        employee: type,
        error: error.message
      };
    }
  }

  /**
   * Assign task to team
   */
  async assignToTeam(teamName, task) {
    const team = this.teams.get(teamName);
    
    if (!team) {
      throw new Error(`Team ${teamName} not found`);
    }

    console.log(`👥 Assigning task to team: ${teamName}`);

    // For now, just use round-robin across employee types
    // In production, this would be more sophisticated
    const assignment = {
      id: this.generateAssignmentId(),
      team: teamName,
      task,
      assignedAt: new Date().toISOString(),
      status: 'assigned'
    };

    this.assignments.set(assignment.id, assignment);

    // Execute with each employee type in parallel
    const results = await Promise.all(
      team.employees.map(async type => {
        try {
          return await this.runEmployee({
            type,
            payload: task.payload || task
          });
        } catch (error) {
          return { type, error: error.message };
        }
      })
    );

    assignment.status = 'completed';
    assignment.completedAt = new Date().toISOString();
    assignment.results = results;

    team.metrics.tasksAssigned++;
    team.metrics.tasksCompleted++;

    return {
      assignmentId: assignment.id,
      results
    };
  }

  /**
   * Create a workflow with multiple employees
   */
  async createWorkflow(steps) {
    console.log(`📋 Creating employee workflow with ${steps.length} steps`);

    const workflow = {
      id: this.generateWorkflowId(),
      steps: steps.map((step, index) => ({
        ...step,
        stepNumber: index + 1,
        status: 'pending'
      })),
      createdAt: new Date().toISOString(),
      status: 'created'
    };

    // Submit to orchestrator
    const result = await orchestrator.submitWorkflow({
      name: `employee-workflow-${workflow.id}`,
      tasks: steps.map(step => ({
        type: step.type,
        payload: step.payload,
        priority: step.priority || 'normal'
      }))
    });

    return {
      workflowId: workflow.id,
      ...result
    };
  }

  /**
   * Get employee status
   */
  getEmployeeStatus(type) {
    const employee = this.employees.get(type);
    
    if (!employee) return null;
    
    return {
      type: employee.type,
      status: employee.status,
      metrics: employee.metrics,
      averageExecutionTime: employee.metrics.tasksCompleted > 0 
        ? employee.metrics.totalExecutionTime / employee.metrics.tasksCompleted 
        : 0
    };
  }

  /**
   * Get team status
   */
  getTeamStatus(teamName) {
    const team = this.teams.get(teamName);
    
    if (!team) return null;
    
    return {
      ...team,
      employees: team.employees.map(type => this.getEmployeeStatus(type))
    };
  }

  /**
   * Get assignment status
   */
  getAssignment(assignmentId) {
    return this.assignments.get(assignmentId);
  }

  /**
   * List all employees
   */
  listEmployees() {
    return Array.from(this.employees.entries()).map(([type, data]) => ({
      type,
      status: data.status,
      tasksCompleted: data.metrics.tasksCompleted
    }));
  }

  /**
   * List all teams
   */
  listTeams() {
    return Array.from(this.teams.entries()).map(([name, data]) => ({
      name,
      employees: data.employees,
      tasksAssigned: data.metrics.tasksAssigned
    }));
  }

  /**
   * Generate assignment ID
   */
  generateAssignmentId() {
    return `assign_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate workflow ID
   */
  generateWorkflowId() {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get system metrics
   */
  getMetrics() {
    return {
      employees: this.listEmployees(),
      teams: this.listTeams(),
      activeAssignments: this.assignments.size,
      totalTasksCompleted: Array.from(this.employees.values())
        .reduce((sum, e) => sum + e.metrics.tasksCompleted, 0)
    };
  }
}

module.exports = new EmployeeManager();
