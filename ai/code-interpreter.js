/**
 * Code Interpreter - Safely executes code in various languages
 */
const vm = require('vm');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execPromise = util.promisify(exec);

class CodeInterpreter {
  constructor() {
    this.supportedLanguages = {
      'javascript': { extension: '.js', timeout: 5000 },
      'python': { extension: '.py', timeout: 10000 },
      'bash': { extension: '.sh', timeout: 5000 },
      'html': { extension: '.html', timeout: 2000 }
    };
    
    this.sandboxDir = path.join(os.tmpdir(), 'cephasgm-code-sandbox');
    this.initSandbox();
  }

  /**
   * Initialize sandbox directory
   */
  async initSandbox() {
    try {
      await fs.mkdir(this.sandboxDir, { recursive: true });
      console.log('Code sandbox initialized at:', this.sandboxDir);
    } catch (error) {
      console.error('Failed to create sandbox:', error);
    }
  }

  /**
   * Run code with language auto-detection
   */
  async run(code, options = {}) {
    try {
      if (!code || typeof code !== 'string') {
        throw new Error('Code must be a non-empty string');
      }

      const {
        language = this.detectLanguage(code),
        timeout = 5000,
        input = ''
      } = options;

      console.log(`Executing ${language} code (${code.length} chars)`);

      // Validate language support
      if (!this.supportedLanguages[language]) {
        throw new Error(`Unsupported language: ${language}`);
      }

      // Route to appropriate executor
      let result;
      switch (language) {
        case 'javascript':
          result = await this.runJavaScript(code, timeout);
          break;
        case 'python':
          result = await this.runPython(code, timeout, input);
          break;
        case 'bash':
          result = await this.runBash(code, timeout);
          break;
        case 'html':
          result = await this.runHtml(code);
          break;
        default:
          result = await this.runJavaScript(code, timeout);
      }

      return {
        success: true,
        language: language,
        output: result.output,
        error: result.error,
        executionTime: result.executionTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Code interpreter error:', error);
      return {
        success: false,
        error: error.message,
        output: `Error: ${error.message}`
      };
    }
  }

  /**
   * Run JavaScript code in sandbox
   */
  async runJavaScript(code, timeout) {
    const startTime = Date.now();
    
    try {
      const sandbox = {
        console: {
          log: (...args) => {
            const output = args.map(arg => 
              typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
            this.sandboxOutput += output + '\n';
          }
        },
        setTimeout: setTimeout,
        Date: Date,
        Math: Math,
        JSON: JSON,
        Array: Array,
        Object: Object
      };

      this.sandboxOutput = '';
      
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code);
      
      // Execute with timeout
      const result = await Promise.race([
        new Promise(resolve => {
          const output = script.runInContext(context, { timeout: timeout });
          resolve(output);
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Execution timeout')), timeout)
        )
      ]);

      const executionTime = Date.now() - startTime;

      return {
        output: this.sandboxOutput || String(result || ''),
        executionTime: `${executionTime}ms`
      };

    } catch (error) {
      return {
        error: error.message,
        executionTime: `${Date.now() - startTime}ms`
      };
    }
  }

  /**
   * Run Python code
   */
  async runPython(code, timeout, input) {
    const startTime = Date.now();
    const filePath = path.join(this.sandboxDir, `script_${Date.now()}.py`);
    
    try {
      // Write code to file
      await fs.writeFile(filePath, code);
      
      // Execute Python
      const { stdout, stderr } = await execPromise(
        `python3 ${filePath}`,
        { timeout: timeout, input: input }
      );

      const executionTime = Date.now() - startTime;

      return {
        output: stdout,
        error: stderr || undefined,
        executionTime: `${executionTime}ms`
      };

    } catch (error) {
      return {
        error: error.message,
        output: error.stdout || '',
        executionTime: `${Date.now() - startTime}ms`
      };
    } finally {
      // Cleanup
      try { await fs.unlink(filePath); } catch (e) {}
    }
  }

  /**
   * Run Bash script
   */
  async runBash(code, timeout) {
    const startTime = Date.now();
    const filePath = path.join(this.sandboxDir, `script_${Date.now()}.sh`);
    
    try {
      // Write script to file
      await fs.writeFile(filePath, code);
      await fs.chmod(filePath, 0o755);
      
      // Execute bash
      const { stdout, stderr } = await execPromise(
        `bash ${filePath}`,
        { timeout: timeout }
      );

      const executionTime = Date.now() - startTime;

      return {
        output: stdout,
        error: stderr || undefined,
        executionTime: `${executionTime}ms`
      };

    } catch (error) {
      return {
        error: error.message,
        output: error.stdout || '',
        executionTime: `${Date.now() - startTime}ms`
      };
    } finally {
      // Cleanup
      try { await fs.unlink(filePath); } catch (e) {}
    }
  }

  /**
   * Run HTML (returns preview)
   */
  async runHtml(code) {
    const startTime = Date.now();
    
    return {
      output: 'HTML preview generated',
      preview: code,
      executionTime: `${Date.now() - startTime}ms`
    };
  }

  /**
   * Detect programming language from code
   */
  detectLanguage(code) {
    const trimmed = code.trim();
    
    if (trimmed.startsWith('#!/bin/bash') || trimmed.includes('apt-get') || trimmed.includes('npm install')) {
      return 'bash';
    }
    
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || trimmed.includes('def ')) {
      return 'python';
    }
    
    if (trimmed.startsWith('<html') || trimmed.includes('<div') || trimmed.includes('<script')) {
      return 'html';
    }
    
    // Default to JavaScript
    return 'javascript';
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return Object.keys(this.supportedLanguages);
  }
}

module.exports = new CodeInterpreter();
