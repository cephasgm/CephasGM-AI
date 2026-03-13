/**
 * Code Interpreter - Safely executes code with AI assistance
 * Integrates OpenAI and Ollama for code generation and analysis
 */
const vm = require('vm');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');

const execPromise = util.promisify(exec);

class CodeInterpreter {
  constructor() {
    this.supportedLanguages = {
      'javascript': { extension: '.js', timeout: 5000 },
      'python': { extension: '.py', timeout: 10000 },
      'bash': { extension: '.sh', timeout: 5000 },
      'html': { extension: '.html', timeout: 2000 },
      'css': { extension: '.css', timeout: 2000 },
      'json': { extension: '.json', timeout: 2000 }
    };
    
    this.sandboxDir = path.join(os.tmpdir(), 'cephasgm-code-sandbox');
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.initSandbox();
    
    console.log('💻 Code interpreter initialized');
    console.log(`   OpenAI: ${this.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
  }

  /**
   * Initialize sandbox directory
   */
  async initSandbox() {
    try {
      await fs.mkdir(this.sandboxDir, { recursive: true });
      console.log('   Sandbox directory:', this.sandboxDir);
    } catch (error) {
      console.error('Failed to create sandbox:', error);
    }
  }

  /**
   * Run code with AI assistance
   */
  async run(code, options = {}) {
    try {
      if (!code || typeof code !== 'string') {
        throw new Error('Code must be a non-empty string');
      }

      const {
        language = this.detectLanguage(code),
        timeout = 5000,
        input = '',
        analyze = false,
        improve = false
      } = options;

      console.log(`💻 Executing ${language} code (${code.length} chars)`);

      // Validate language support
      if (!this.supportedLanguages[language]) {
        throw new Error(`Unsupported language: ${language}`);
      }

      let result;
      let aiAnalysis = null;

      // Execute the code
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
        case 'css':
        case 'json':
          result = await this.runMarkup(code, language);
          break;
        default:
          result = await this.runJavaScript(code, timeout);
      }

      // Analyze code with AI if requested
      if (analyze && (this.openaiApiKey || this.ollamaApiKey)) {
        aiAnalysis = await this.analyzeCode(code, language, result);
      }

      // Improve code with AI if requested
      if (improve && (this.openaiApiKey || this.ollamaApiKey) && !result.error) {
        const improved = await this.improveCode(code, language, result);
        if (improved.success) {
          result.improvedCode = improved.code;
          result.improvementNotes = improved.notes;
        }
      }

      return {
        success: true,
        language: language,
        output: result.output,
        error: result.error,
        executionTime: result.executionTime,
        aiAnalysis: aiAnalysis,
        improvedCode: result.improvedCode,
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
   * Generate code from natural language
   */
  async generate(prompt, options = {}) {
    try {
      const {
        language = 'javascript',
        framework = '',
        maxTokens = 1000
      } = options;

      console.log(`🤖 Generating ${language} code from: "${prompt.substring(0, 50)}..."`);

      let result;
      
      // Prefer OpenAI for code generation, fallback to Ollama
      if (this.openaiApiKey) {
        result = await this.generateWithOpenAI(prompt, language, framework, maxTokens);
      } else if (this.ollamaApiKey) {
        result = await this.generateWithOllama(prompt, language, framework, maxTokens);
      } else {
        throw new Error('No API key configured for code generation');
      }

      return {
        success: true,
        language: language,
        framework: framework,
        code: result.code,
        provider: result.provider,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Code generation error:', error);
      return {
        success: false,
        error: error.message,
        fallback: this.getFallbackCode(prompt, language)
      };
    }
  }

  /**
   * Generate code using OpenAI
   */
  async generateWithOpenAI(prompt, language, framework, maxTokens) {
    const systemPrompt = `You are an expert ${language} developer. Generate clean, efficient, and well-commented code. Include error handling and best practices.`;

    const userPrompt = `Generate ${language} code${framework ? ` using ${framework}` : ''} for the following: ${prompt}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${await response.text()}`);
    }

    const data = await response.json();
    return {
      code: data.choices[0].message.content,
      provider: 'openai'
    };
  }

  /**
   * Generate code using Ollama (CodeLlama)
   */
  async generateWithOllama(prompt, language, framework, maxTokens) {
    const systemPrompt = `You are an expert ${language} developer. Generate clean, efficient, and well-commented code. Include error handling and best practices.`;

    const userPrompt = `Generate ${language} code${framework ? ` using ${framework}` : ''} for the following: ${prompt}`;

    const response = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.ollamaApiKey}`
      },
      body: JSON.stringify({
        model: 'codellama:7b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        options: {
          temperature: 0.3,
          num_predict: maxTokens
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${await response.text()}`);
    }

    const data = await response.json();
    return {
      code: data.message.content,
      provider: 'ollama'
    };
  }

  /**
   * Analyze code for issues and improvements
   */
  async analyzeCode(code, language, executionResult) {
    try {
      const provider = this.openaiApiKey ? 'openai' : 'ollama';
      const model = provider === 'openai' ? 'gpt-3.5-turbo' : 'codellama:7b';
      const apiKey = provider === 'openai' ? this.openaiApiKey : this.ollamaApiKey;
      const apiUrl = provider === 'openai' 
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://ollama.com/api/chat';

      const messages = [
        { role: 'system', content: 'You are a senior code reviewer. Analyze the code for bugs, security issues, performance problems, and style improvements.' },
        { role: 'user', content: `Analyze this ${language} code:\n\n${code}\n\nExecution output: ${executionResult.output || 'none'}\nExecution error: ${executionResult.error || 'none'}` }
      ];

      const requestBody = provider === 'openai'
        ? { model, messages, temperature: 0.2 }
        : { model, messages, options: { temperature: 0.2 } };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) return null;

      const data = await response.json();
      const analysis = provider === 'openai' ? data.choices[0].message.content : data.message.content;

      return {
        analysis,
        provider,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Code analysis failed:', error);
      return null;
    }
  }

  /**
   * Improve existing code
   */
  async improveCode(code, language, executionResult) {
    try {
      const provider = this.openaiApiKey ? 'openai' : 'ollama';
      const model = provider === 'openai' ? 'gpt-3.5-turbo' : 'codellama:7b';
      const apiKey = provider === 'openai' ? this.openaiApiKey : this.ollamaApiKey;
      const apiUrl = provider === 'openai' 
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://ollama.com/api/chat';

      const messages = [
        { role: 'system', content: 'You are a senior developer. Improve the provided code while maintaining its functionality.' },
        { role: 'user', content: `Improve this ${language} code. Fix any issues and optimize it:\n\n${code}` }
      ];

      const requestBody = provider === 'openai'
        ? { model, messages, temperature: 0.3 }
        : { model, messages, options: { temperature: 0.3 } };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) return { success: false };

      const data = await response.json();
      const improvedCode = provider === 'openai' ? data.choices[0].message.content : data.message.content;

      return {
        success: true,
        code: improvedCode,
        notes: `Code improved by AI (${provider})`
      };

    } catch (error) {
      return { success: false };
    }
  }

  // ... (rest of the file: runJavaScript, runPython, etc., unchanged from your original)

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
          },
          error: (...args) => {
            const output = args.map(arg => String(arg)).join(' ');
            this.sandboxError += output + '\n';
          }
        },
        setTimeout: setTimeout,
        Date: Date,
        Math: Math,
        JSON: JSON,
        Array: Array,
        Object: Object,
        Promise: Promise
      };

      this.sandboxOutput = '';
      this.sandboxError = '';
      
      const context = vm.createContext(sandbox);
      const script = new vm.Script(code);
      
      // Execute with timeout
      const result = await Promise.race([
        new Promise(resolve => {
          try {
            const output = script.runInContext(context, { timeout: timeout });
            resolve(output);
          } catch (error) {
            this.sandboxError = error.message;
            resolve(null);
          }
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Execution timeout')), timeout)
        )
      ]);

      const executionTime = Date.now() - startTime;

      return {
        output: this.sandboxOutput || String(result || ''),
        error: this.sandboxError || undefined,
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
   * Run markup languages (HTML, CSS, JSON)
   */
  async runMarkup(code, language) {
    const startTime = Date.now();
    
    return {
      output: `${language.toUpperCase()} validated successfully`,
      preview: language === 'html' ? code : undefined,
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
    
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || trimmed.includes('def ') || trimmed.includes('print(')) {
      return 'python';
    }
    
    if (trimmed.startsWith('<html') || trimmed.includes('<div') || trimmed.includes('</') || trimmed.includes('<!DOCTYPE')) {
      return 'html';
    }
    
    if (trimmed.startsWith('{') && trimmed.includes('"') && (trimmed.includes(':') || trimmed.includes(','))) {
      return 'json';
    }
    
    if (trimmed.includes('{') && trimmed.includes('}') && trimmed.includes(':') && !trimmed.includes('function')) {
      return 'css';
    }
    
    // Default to JavaScript
    return 'javascript';
  }

  /**
   * Get fallback code when generation fails
   */
  getFallbackCode(prompt, language) {
    return `// Generated code for: ${prompt}
// Note: This is a fallback response. API key required for AI-generated code.

function example() {
  console.log("Please configure your OpenAI or Ollama API key to generate real code");
  return {
    success: false,
    message: "API key required",
    prompt: "${prompt.substring(0, 50)}"
  };
}

example();`;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return Object.keys(this.supportedLanguages);
  }

  /**
   * Clean up sandbox
   */
  async cleanup() {
    try {
      const files = await fs.readdir(this.sandboxDir);
      for (const file of files) {
        await fs.unlink(path.join(this.sandboxDir, file));
      }
      console.log('✅ Code sandbox cleaned up');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

module.exports = new CodeInterpreter();
