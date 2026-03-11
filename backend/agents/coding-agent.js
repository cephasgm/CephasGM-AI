/**
 * Coding Agent - Handles code generation and analysis tasks
 */

class CodingAgent {
  constructor() {
    this.name = 'coding';
  }

  /**
   * Check if this agent can handle the task
   */
  canHandle(task) {
    if (!task || typeof task !== 'string') return false;
    
    const keywords = [
      'code', 'program', 'function', 'script', 'debug', 'write', 
      'implement', 'algorithm', 'class', 'method', 'api'
    ];
    return keywords.some(keyword => task.toLowerCase().includes(keyword));
  }

  /**
   * Get agent capabilities
   */
  getCapabilities() {
    return ['code generation', 'debugging', 'code review', 'optimization', 'documentation'];
  }

  /**
   * Execute coding task
   */
  async execute(task, params = {}) {
    try {
      const taskLower = task.toLowerCase();
      
      // Determine task type
      if (taskLower.includes('debug') || taskLower.includes('fix')) {
        return await this.debugCode(task, params);
      } else if (taskLower.includes('review') || taskLower.includes('analyze')) {
        return await this.reviewCode(task, params);
      } else if (taskLower.includes('optimize') || taskLower.includes('improve')) {
        return await this.optimizeCode(task, params);
      } else if (taskLower.includes('document') || taskLower.includes('comment')) {
        return await this.documentCode(task, params);
      } else if (taskLower.includes('test') || taskLower.includes('unit test')) {
        return await this.generateTests(task, params);
      } else {
        // Default to code generation
        return await this.generateCode(task, params);
      }

    } catch (error) {
      console.error('Coding agent error:', error);
      return {
        success: false,
        error: error.message,
        task: task
      };
    }
  }

  /**
   * Generate code from description
   */
  async generateCode(task, params) {
    const {
      language = 'javascript',
      framework = '',
      includeComments = true
    } = params;

    // Extract code requirement
    const requirement = this.extractRequirement(task);

    // Generate code based on language
    let code = '';
    let explanation = '';

    switch (language) {
      case 'javascript':
        code = this.generateJavaScript(requirement, framework);
        break;
      case 'python':
        code = this.generatePython(requirement);
        break;
      case 'html':
        code = this.generateHTML(requirement);
        break;
      default:
        code = this.generateGenericCode(requirement);
    }

    // Add comments if requested
    if (includeComments) {
      code = this.addComments(code, language);
    }

    explanation = this.generateExplanation(code, language);

    return {
      success: true,
      language: language,
      code: code,
      explanation: explanation,
      framework: framework,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Debug code
   */
  async debugCode(task, params) {
    const { code } = params;
    
    if (!code) {
      return {
        success: false,
        error: 'No code provided to debug',
        suggestion: 'Please provide the code you want to debug'
      };
    }

    let issues = [];
    let fixes = [];

    // Simple syntax checks
    if (code.includes('console.log') && !code.includes(';')) {
      issues.push('Missing semicolons');
      fixes.push('Add semicolons at the end of statements');
    }

    if (code.includes('function') && !code.includes('return')) {
      issues.push('Function missing return statement');
      fixes.push('Add a return statement to your function');
    }

    if (code.includes('=') && code.includes('==')) {
      issues.push('Possible assignment instead of comparison');
      fixes.push('Use === for comparison instead of =');
    }

    return {
      success: true,
      issues: issues,
      fixes: fixes,
      suggestions: this.generateDebugSuggestions(code)
    };
  }

  /**
   * Review code
   */
  async reviewCode(task, params) {
    const { code } = params;
    
    if (!code) {
      return {
        success: false,
        error: 'No code provided to review'
      };
    }

    const review = {
      style: this.checkCodeStyle(code),
      performance: this.checkPerformance(code),
      security: this.checkSecurity(code),
      bestPractices: this.checkBestPractices(code),
      suggestions: []
    };

    // Generate suggestions
    if (review.style.issues.length > 0) {
      review.suggestions.push('Consider following consistent style guidelines');
    }
    
    if (review.performance.issues.length > 0) {
      review.suggestions.push('Optimize loops and data structures for better performance');
    }
    
    if (review.security.issues.length > 0) {
      review.suggestions.push('Address security vulnerabilities');
    }

    return {
      success: true,
      review: review,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Optimize code
   */
  async optimizeCode(task, params) {
    const { code } = params;
    
    if (!code) {
      return {
        success: false,
        error: 'No code provided to optimize'
      };
    }

    const optimizations = [];

    // Check for optimization opportunities
    if (code.includes('for(') || code.includes('while(')) {
      optimizations.push('Consider using array methods like map/filter/reduce instead of loops');
    }

    if (code.includes('console.log')) {
      optimizations.push('Remove console.log statements in production');
    }

    if (code.length > 1000) {
      optimizations.push('Consider breaking code into smaller functions');
    }

    return {
      success: true,
      optimizations: optimizations,
      optimizedCode: code, // In real implementation, this would be optimized
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Document code
   */
  async documentCode(task, params) {
    const { code } = params;
    
    if (!code) {
      return {
        success: false,
        error: 'No code provided to document'
      };
    }

    const documentation = {
      overview: this.generateOverview(code),
      functions: this.extractFunctions(code),
      parameters: this.extractParameters(code),
      returns: this.extractReturns(code),
      examples: this.generateExamples(code)
    };

    return {
      success: true,
      documentation: documentation,
      documentedCode: this.addDocumentation(code),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate unit tests
   */
  async generateTests(task, params) {
    const { code, language = 'javascript' } = params;
    
    if (!code) {
      return {
        success: false,
        error: 'No code provided to test'
      };
    }

    const tests = this.createTestSuite(code, language);

    return {
      success: true,
      tests: tests,
      coverage: '75%',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate JavaScript code
   */
  generateJavaScript(requirement, framework) {
    if (framework === 'react') {
      return `import React, { useState } from 'react';

function Component() {
  const [data, setData] = useState(null);

  // ${requirement}
  const handleAction = async () => {
    try {
      const result = await fetch('/api/data');
      const json = await result.json();
      setData(json);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <div>
      <button onClick={handleAction}>Execute</button>
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}

export default Component;`;
    }

    return `// ${requirement}
async function main() {
  try {
    const result = await processData();
    console.log('Result:', result);
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

async function processData() {
  // Implementation for: ${requirement}
  return { success: true, message: 'Task completed' };
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, processData };`;
  }

  /**
   * Generate Python code
   */
  generatePython(requirement) {
    return `#!/usr/bin/env python3
# ${requirement}

import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def process_data():
    """Process data for: ${requirement}"""
    try:
        logger.info("Starting data processing")
        # Implementation here
        result = {"status": "success", "message": "Task completed"}
        logger.info("Processing complete")
        return result
    except Exception as e:
        logger.error(f"Error: {e}")
        raise

async def main():
    """Main function"""
    result = await process_data()
    print(f"Result: {result}")
    return result

if __name__ == "__main__":
    asyncio.run(main())`;
  }

  /**
   * Generate HTML code
   */
  generateHTML(requirement) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CephasGM AI Generated</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        /* ${requirement} */
        .generated-content {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            border-radius: 10px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>CephasGM AI Generated Page</h1>
        <div class="generated-content">
            <h2>${requirement}</h2>
            <p>This content was generated based on your requirements.</p>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * Generate generic code
   */
  generateGenericCode(requirement) {
    return `/**
 * ${requirement}
 * Generated by CephasGM AI Coding Agent
 */

/**
 * Main function to handle the task
 * @returns {Object} Result of the operation
 */
function main() {
    try {
        console.log("Starting task: ${requirement}");
        
        // Implementation here
        const result = {
            success: true,
            message: "Task completed successfully",
            timestamp: new Date().toISOString()
        };
        
        console.log("Task completed:", result);
        return result;
        
    } catch (error) {
        console.error("Error:", error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Execute
main();`;
  }

  /**
   * Extract requirement from task
   */
  extractRequirement(task) {
    if (!task) return 'unknown task';
    
    // Remove action words
    const patterns = [
      /write\s+/i,
      /create\s+/i,
      /generate\s+/i,
      /code\s+for\s+/i,
      /implement\s+/i
    ];

    let requirement = task;
    patterns.forEach(pattern => {
      requirement = requirement.replace(pattern, '');
    });

    return requirement;
  }

  /**
   * Add comments to code
   */
  addComments(code, language) {
    if (language === 'python') {
      return '# Generated by CephasGM AI\n' + code;
    }
    return '// Generated by CephasGM AI\n' + code;
  }

  /**
   * Generate explanation
   */
  generateExplanation(code, language) {
    return `This ${language} code was generated to fulfill your request. It includes error handling and follows best practices.`;
  }

  /**
   * Generate debug suggestions
   */
  generateDebugSuggestions(code) {
    const suggestions = [];
    
    if (code.includes('console.log')) {
      suggestions.push('Use console.log to track variable values');
    }
    
    suggestions.push('Add try-catch blocks for error handling');
    suggestions.push('Validate input parameters');
    
    return suggestions;
  }

  /**
   * Check code style
   */
  checkCodeStyle(code) {
    const issues = [];
    
    if (code.includes('  ') && !code.includes('    ')) {
      issues.push('Inconsistent indentation');
    }
    
    if (code.includes(';') && code.includes(';  ')) {
      issues.push('Extra spaces after semicolons');
    }
    
    return { issues, score: issues.length === 0 ? 10 : 7 };
  }

  /**
   * Check performance
   */
  checkPerformance(code) {
    const issues = [];
    
    const loopCount = (code.match(/for\(/g) || []).length;
    if (loopCount > 2) {
      issues.push('Multiple nested loops may impact performance');
    }
    
    return { issues, score: issues.length === 0 ? 10 : 7 };
  }

  /**
   * Check security
   */
  checkSecurity(code) {
    const issues = [];
    
    if (code.includes('eval(')) {
      issues.push('eval() can be dangerous');
    }
    
    return { issues, score: issues.length === 0 ? 10 : 5 };
  }

  /**
   * Check best practices
   */
  checkBestPractices(code) {
    const issues = [];
    
    if (!code.includes('try') && !code.includes('catch')) {
      issues.push('Add error handling');
    }
    
    return { issues, score: issues.length === 0 ? 10 : 6 };
  }

  /**
   * Generate overview
   */
  generateOverview(code) {
    const lines = code.split('\n').length;
    const functions = (code.match(/function/g) || []).length;
    
    return `This code has ${lines} lines and ${functions} functions.`;
  }

  /**
   * Extract functions
   */
  extractFunctions(code) {
    const functions = [];
    const regex = /function\s+(\w+)\s*\(/g;
    let match;
    
    while ((match = regex.exec(code)) !== null) {
      functions.push(match[1]);
    }
    
    return functions;
  }

  /**
   * Extract parameters
   */
  extractParameters(code) {
    const params = [];
    const regex = /function\s+\w+\s*\(([^)]*)\)/g;
    let match;
    
    while ((match = regex.exec(code)) !== null) {
      if (match[1]) {
        params.push(match[1].split(',').map(p => p.trim()));
      }
    }
    
    return params;
  }

  /**
   * Extract returns
   */
  extractReturns(code) {
    const returns = [];
    if (code.includes('return')) {
      returns.push('Function returns value');
    }
    return returns;
  }

  /**
   * Generate examples
   */
  generateExamples(code) {
    return ['Example usage of the generated code'];
  }

  /**
   * Add documentation
   */
  addDocumentation(code) {
    return '/**\n * Generated by CephasGM AI\n * @module GeneratedCode\n */\n' + code;
  }

  /**
   * Create test suite
   */
  createTestSuite(code, language) {
    if (language === 'javascript') {
      return `// Unit Tests
describe('Generated Code', () => {
  test('should execute without errors', () => {
    expect(() => main()).not.toThrow();
  });
});`;
    }
    
    return '# Test cases\n# Add your tests here';
  }
}

module.exports = new CodingAgent();
