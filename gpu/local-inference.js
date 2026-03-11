/**
 * Local GPU Inference - Run models on local GPU
 */
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execPromise = util.promisify(exec);

class LocalInference {
  constructor() {
    this.models = {
      'llama3': { command: 'ollama run llama3', type: 'llm' },
      'mistral': { command: 'ollama run mistral', type: 'llm' },
      'phi3': { command: 'ollama run phi3', type: 'llm' },
      'codellama': { command: 'ollama run codellama', type: 'code' }
    };
    
    this.gpuAvailable = this.checkGpuAvailability();
    this.ollamaAvailable = false;
    this.checkOllama();
  }

  /**
   * Check if GPU is available
   */
  checkGpuAvailability() {
    try {
      const platform = os.platform();
      
      if (platform === 'linux' || platform === 'win32') {
        // Quick check for nvidia-smi
        const result = execSync('which nvidia-smi', { stdio: 'ignore' });
        return true;
      }
    } catch {
      // No GPU or nvidia-smi not found
    }
    
    return false;
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execPromise('ollama --version');
      this.ollamaAvailable = true;
      console.log('✅ Ollama detected - local models available');
    } catch {
      console.log('⚠️ Ollama not found - using simulation mode');
      this.ollamaAvailable = false;
    }
  }

  /**
   * Run inference on local model
   */
  async run(prompt, model = 'llama3', options = {}) {
    try {
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      console.log(`Running local inference with ${model}: "${prompt.substring(0, 50)}..."`);

      // Check if model exists
      if (!this.models[model]) {
        throw new Error(`Model ${model} not found. Available: ${Object.keys(this.models).join(', ')}`);
      }

      // Route to appropriate inference method
      let result;
      
      if (this.ollamaAvailable) {
        result = await this.runOllama(prompt, model, options);
      } else {
        result = await this.simulateInference(prompt, model, options);
      }

      return {
        success: true,
        model: model,
        prompt: prompt,
        output: result.output,
        tokens: result.tokens || 0,
        timing: result.timing || 0,
        gpu: this.gpuAvailable,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Local inference error:', error);
      return {
        success: false,
        error: error.message,
        model: model,
        fallback: this.getFallbackResponse(prompt)
      };
    }
  }

  /**
   * Run inference with Ollama
   */
  async runOllama(prompt, model, options) {
    const startTime = Date.now();
    
    const modelConfig = this.models[model];
    const command = modelConfig.command;
    
    try {
      const { stdout, stderr } = await execPromise(
        `echo "${prompt}" | ${command}`,
        { timeout: options.timeout || 30000 }
      );

      const executionTime = Date.now() - startTime;

      if (stderr) {
        console.warn('Ollama warning:', stderr);
      }

      return {
        output: stdout.trim(),
        tokens: Math.round(prompt.length / 4), // Rough estimate
        timing: executionTime
      };

    } catch (error) {
      console.log('Ollama execution failed, falling back to simulation:', error.message);
      return this.simulateInference(prompt, model, options);
    }
  }

  /**
   * Simulate inference for demo/fallback
   */
  async simulateInference(prompt, model, options) {
    // Simulate processing time based on prompt length
    const processingTime = Math.min(500 + prompt.length * 2, 5000);
    await this.simulateDelay(processingTime);

    let output;
    
    switch (model) {
      case 'codellama':
        output = this.generateCodeResponse(prompt);
        break;
      case 'llama3':
      case 'mistral':
      case 'phi3':
      default:
        output = this.generateTextResponse(prompt);
    }

    return {
      output: output,
      tokens: Math.round(prompt.length / 4),
      timing: processingTime
    };
  }

  /**
   * Generate text response
   */
  generateTextResponse(prompt) {
    const responses = [
      `Based on your query about "${prompt.substring(0, 50)}", I can provide the following insights from the ${prompt.includes('?') ? 'perspective' : 'analysis'}...\n\nThis is a simulated response from the local model. In production with Ollama, you would get real model output.`,
      
      `I understand you're asking about "${prompt.substring(0, 40)}". From my training data, I can share that this relates to several key concepts in AI and technology.\n\nHowever, since this is running in simulation mode, I'm providing a placeholder response.`,
      
      `Thanks for your question about ${prompt.substring(0, 30)}. The local model would typically generate a detailed response here, but Ollama is not currently available.\n\nTo use real models, install Ollama and pull the model: ollama pull ${prompt.includes('code') ? 'codellama' : 'llama3'}`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Generate code response
   */
  generateCodeResponse(prompt) {
    if (prompt.toLowerCase().includes('function') || prompt.toLowerCase().includes('write')) {
      return `// Generated code based on: ${prompt}
function exampleFunction() {
  // Implementation here
  const result = {
    success: true,
    message: "This is a simulated code response",
    timestamp: new Date().toISOString()
  };
  return result;
}

// Example usage
const output = exampleFunction();
console.log(output);`;
    }
    
    return `// Code analysis for: ${prompt}
// In production with Ollama + CodeLlama, you'd get real code here
// For now, this is a simulation

function analyzeCode(code) {
  // Simulated analysis
  return {
    complexity: "medium",
    lines: code.split('\\n').length,
    suggestions: [
      "Add error handling",
      "Include comments",
      "Optimize loops"
    ]
  };
}`;
  }

  /**
   * Get fallback response
   */
  getFallbackResponse(prompt) {
    return `I received your prompt: "${prompt.substring(0, 100)}". However, local inference encountered an error. Please check if Ollama is installed and running.`;
  }

  /**
   * Check if model is available
   */
  async isModelAvailable(model) {
    if (!this.ollamaAvailable) return false;
    
    try {
      const { stdout } = await execPromise('ollama list');
      return stdout.includes(model);
    } catch {
      return false;
    }
  }

  /**
   * Pull a model
   */
  async pullModel(model) {
    if (!this.ollamaAvailable) {
      throw new Error('Ollama not available');
    }

    console.log(`Pulling model ${model}...`);
    
    const process = exec(`ollama pull ${model}`);
    
    return new Promise((resolve, reject) => {
      process.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        console.error(data.toString());
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, model });
        } else {
          reject(new Error(`Failed to pull model ${model}`));
        }
      });
    });
  }

  /**
   * Get available models
   */
  async getAvailableModels() {
    if (!this.ollamaAvailable) {
      return Object.keys(this.models).map(name => ({
        name,
        available: false,
        type: this.models[name].type
      }));
    }

    try {
      const { stdout } = await execPromise('ollama list');
      const lines = stdout.split('\n').slice(1);
      
      return lines
        .filter(line => line.trim())
        .map(line => {
          const [name, ...rest] = line.split(/\s+/);
          return {
            name,
            available: true,
            type: name.includes('code') ? 'code' : 'llm'
          };
        });
    } catch {
      return Object.keys(this.models).map(name => ({
        name,
        available: false,
        type: this.models[name].type
      }));
    }
  }

  /**
   * Get GPU status
   */
  getGpuStatus() {
    return {
      available: this.gpuAvailable,
      ollama: this.ollamaAvailable,
      models: Object.keys(this.models)
    };
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new LocalInference();
