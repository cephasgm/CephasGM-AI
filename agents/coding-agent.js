/**
 * Coding Agent - Code generation and execution
 */
const Agent = require("../core/agent-runtime");
const vm = require("vm");

class CodingAgent extends Agent {
  constructor() {
    super("coding", {
      timeout: 10000,
      maxRetries: 1
    });
    
    this.languages = ['javascript', 'python', 'html', 'bash'];
    this.codeHistory = [];
  }

  /**
   * Check if agent can handle task
   */
  canHandle(task) {
    const keywords = [
      'code', 'program', 'function', 'script', 'run code', 'execute',
      'algorithm', 'class', 'method', 'api', 'debug', 'fix code'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['code generation', 'code execution', 'debugging', 'code review'];
  }

  /**
   * Execute coding task
   */
  async execute(task) {
    this.validateTask(task);
    
    console.log(`💻 Coding agent processing: "${task.substring(0, 50)}..."`);
    
    // Determine task type
    if (task.toLowerCase().includes('run code')) {
      return await this.runCode(task);
    } else if (task.toLowerCase().includes('debug') || task.toLowerCase().includes('fix')) {
      return await this.debugCode(task);
    } else if (task.toLowerCase().includes('explain')) {
      return await this.explainCode(task);
    } else {
      return await this.generateCode(task);
    }
  }

  /**
   * Run code in sandbox
   */
  async runCode(task) {
    const code = this.extractCode(task);
    
    if (!code) {
      return {
        error: 'No code found to execute',
        suggestion: 'Provide code after "run code"'
      };
    }

    try {
      const sandbox = {
        console: {
          log: (...args) => {
            const output = args.map(arg => 
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.lastOutput = (this.lastOutput || '') + output + '\n';
          }
        },
        setTimeout,
        Date,
        Math,
        JSON
      };

      this.lastOutput = '';
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code);
      
      const result = script.runInContext(context, { timeout: 5000 });
      
      const output = {
        result: result !== undefined ? String(result) : undefined,
        console: this.lastOutput.trim(),
        executionTime: 'simulated'
      };
      
      // Save to history
      this.codeHistory.push({
        task,
        code,
        output,
        timestamp: new Date().toISOString()
      });
      
      return output;
      
    } catch (error) {
      return {
        error: error.message,
        line: error.lineNumber,
        column: error.columnNumber
      };
    }
  }

  /**
   * Generate code based on description
   */
  async generateCode(task) {
    const description = task.replace(/code|generate|write|create/gi, '').trim();
    
    if (description.toLowerCase().includes('function')) {
      return this.generateFunction(description);
    } else if (description.toLowerCase().includes('class')) {
      return this.generateClass(description);
    } else if (description.toLowerCase().includes('api')) {
      return this.generateAPI(description);
    } else {
      return this.generateGenericCode(description);
    }
  }

  /**
   * Debug code
   */
  async debugCode(task) {
    const code = this.extractCode(task);
    
    if (!code) {
      return {
        error: 'No code to debug',
        suggestion: 'Provide the code that needs debugging'
      };
    }

    const issues = [];
    
    // Check for common issues
    if (code.includes('console.log') && code.includes('console.log') > 3) {
      issues.push('Too many console.log statements');
    }
    
    if (!code.includes('try') && code.includes('async')) {
      issues.push('Async function without try/catch');
    }
    
    if (code.includes('var ')) {
      issues.push('Consider using let/const instead of var');
    }
    
    return {
      issues,
      suggestions: issues.map(issue => `Fix: ${issue}`),
      code
    };
  }

  /**
   * Explain code
   */
  async explainCode(task) {
    const code = this.extractCode(task);
    
    if (!code) {
      return {
        explanation: 'No code provided to explain'
      };
    }

    const lines = code.split('\n');
    const functions = (code.match(/function/g) || []).length;
    const variables = (code.match(/var|let|const/g) || []).length;
    
    return {
      summary: `This code has ${lines.length} lines, ${functions} functions, and ${variables} variable declarations.`,
      complexity: lines.length > 50 ? 'high' : lines.length > 20 ? 'medium' : 'low',
      suggestions: [
        'Add comments for complex logic',
        'Consider breaking into smaller functions',
        'Add error handling'
      ]
    };
  }

  /**
   * Generate function
   */
  generateFunction(description) {
    const funcName = description.match(/function\s+(\w+)/i)?.[1] || 'exampleFunction';
    
    return `// Generated function: ${description}
function ${funcName}(params) {
  try {
    // TODO: Implement ${description}
    const result = {
      success: true,
      message: 'Function executed successfully',
      params
    };
    
    return result;
    
  } catch (error) {
    console.error('Error in ${funcName}:', error);
    throw error;
  }
}

// Example usage:
// const output = ${funcName}({ key: 'value' });
// console.log(output);`;
  }

  /**
   * Generate class
   */
  generateClass(description) {
    const className = description.match(/class\s+(\w+)/i)?.[1] || 'ExampleClass';
    
    return `// Generated class: ${description}
class ${className} {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
  }
  
  async initialize() {
    // TODO: Initialize resources
    this.initialized = true;
    console.log('${className} initialized');
    return this;
  }
  
  async process(data) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // TODO: Implement processing logic
    return {
      success: true,
      data,
      timestamp: new Date().toISOString()
    };
  }
  
  destroy() {
    // TODO: Cleanup resources
    this.initialized = false;
    console.log('${className} destroyed');
  }
}

// Example usage:
// const instance = new ${className}({});
// await instance.process({ test: 'data' });`;
  }

  /**
   * Generate API endpoint
   */
  generateAPI(description) {
    return `// Generated API endpoint: ${description}
const express = require('express');
const router = express.Router();

/**
 * GET endpoint
 */
router.get('/api/resource', async (req, res) => {
  try {
    // TODO: Implement GET logic
    res.json({
      success: true,
      data: [],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST endpoint
 */
router.post('/api/resource', async (req, res) => {
  try {
    const { body } = req;
    
    // TODO: Implement POST logic
    res.json({
      success: true,
      received: body,
      id: Date.now(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;`;
  }

  /**
   * Generate generic code
   */
  generateGenericCode(description) {
    return `// Generated code for: ${description}
/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting task: ${description}');
    
    // TODO: Implement your logic here
    
    const result = {
      success: true,
      message: 'Task completed',
      timestamp: new Date().toISOString()
    };
    
    console.log('Task completed:', result);
    return result;
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };`;
  }

  /**
   * Extract code from task
   */
  extractCode(task) {
    const patterns = [
      /run code\s*([\s\S]*)/i,
      /debug\s*([\s\S]*)/i,
      /fix code\s*([\s\S]*)/i,
      /explain\s*([\s\S]*)/i
    ];
    
    for (const pattern of patterns) {
      const match = task.match(pattern);
      if (match && match[1] && match[1].trim()) {
        return match[1].trim();
      }
    }
    
    // If no pattern matches, try to find code blocks
    const codeBlockMatch = task.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    return null;
  }

  /**
   * Get code history
   */
  getHistory() {
    return this.codeHistory;
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.codeHistory = [];
    console.log('Code history cleared');
  }
}

module.exports = new CodingAgent();
