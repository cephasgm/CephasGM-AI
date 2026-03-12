/**
 * Local GPU Inference - Run models on local GPU or fallback to Ollama Cloud
 * Now integrated with Ollama Cloud for cloud inference when GPU not available
 */
const { exec, spawn } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');

const execPromise = util.promisify(exec);

class LocalInference {
  constructor() {
    this.models = {
      'llama3': { 
        command: 'ollama run llama3', 
        type: 'llm',
        cloudModel: 'llama3:8b',
        size: '8B'
      },
      'llama3.2': { 
        command: 'ollama run llama3.2', 
        type: 'llm',
        cloudModel: 'llama3.2:3b',
        size: '3B'
      },
      'mistral': { 
        command: 'ollama run mistral', 
        type: 'llm',
        cloudModel: 'mistral:7b',
        size: '7B'
      },
      'phi3': { 
        command: 'ollama run phi3', 
        type: 'llm',
        cloudModel: 'phi3:3.8b',
        size: '3.8B'
      },
      'codellama': { 
        command: 'ollama run codellama', 
        type: 'code',
        cloudModel: 'codellama:7b',
        size: '7B'
      },
      'neural-chat': { 
        command: 'ollama run neural-chat', 
        type: 'llm',
        cloudModel: 'neural-chat:7b',
        size: '7B'
      },
      'nomic-embed': { 
        command: 'ollama run nomic-embed-text', 
        type: 'embedding',
        cloudModel: 'nomic-embed-text:v1.5',
        size: '137M'
      }
    };
    
    this.gpuAvailable = false;
    this.ollamaAvailable = false;
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.environment = process.env.RENDER ? 'render' : 'local';
    
    this.initialize();
  }

  /**
   * Initialize and check availability
   */
  async initialize() {
    console.log('\n🖥️  GPU/Local Inference Initializing...');
    
    // Check GPU availability
    this.gpuAvailable = await this.checkGpuAvailability();
    
    // Check Ollama local availability
    if (this.environment === 'local') {
      await this.checkOllamaLocal();
    }
    
    // Display status
    this.displayStatus();
  }

  /**
   * Display initialization status
   */
  displayStatus() {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  🖥️  Inference Engine Status                               ║
╠══════════════════════════════════════════════════════════╣
║  📡 Environment: ${this.environment.padEnd(30)} ║
║  🎮 GPU Available: ${this.gpuAvailable ? '✅'.padEnd(30) : '❌'.padEnd(30)} ║
║  💻 Local Ollama: ${this.ollamaAvailable ? '✅'.padEnd(30) : '❌'.padEnd(30)} ║
║  ☁️  Ollama Cloud: ${this.ollamaApiKey ? '✅ Configured'.padEnd(27) : '❌ No API Key'.padEnd(27)} ║
║  📊 Models Available: ${Object.keys(this.models).length.toString().padEnd(30)} ║
╚══════════════════════════════════════════════════════════╝
    `);

    if (this.environment === 'render' && !this.ollamaApiKey) {
      console.log('⚠️  Running on Render with no Ollama API key. Add OLLAMA_API_KEY to enable cloud inference.');
    }
  }

  /**
   * Check if GPU is available
   */
  async checkGpuAvailability() {
    // On Render, GPU is never available
    if (this.environment === 'render') {
      return false;
    }

    try {
      const platform = os.platform();
      
      if (platform === 'linux' || platform === 'win32') {
        // Check for nvidia-smi
        const { stdout } = await execPromise('which nvidia-smi').catch(() => ({ stdout: '' }));
        if (stdout) {
          const { stdout: smiOutput } = await execPromise('nvidia-smi --query-gpu=name --format=csv,noheader');
          console.log(`✅ GPU detected: ${smiOutput.trim()}`);
          return true;
        }
      }
    } catch {
      // No GPU
    }
    
    return false;
  }

  /**
   * Check if Ollama is available locally
   */
  async checkOllamaLocal() {
    try {
      await execPromise('ollama --version');
      this.ollamaAvailable = true;
      
      // Check which models are installed
      const { stdout } = await execPromise('ollama list');
      const installedModels = stdout.split('\n')
        .slice(1)
        .filter(line => line.trim())
        .map(line => line.split(/\s+/)[0]);
      
      console.log(`✅ Ollama detected with ${installedModels.length} models installed`);
      
    } catch {
      this.ollamaAvailable = false;
    }
  }

  /**
   * Run inference on model (auto-selects best available backend)
   */
  async run(prompt, model = 'llama3.2', options = {}) {
    try {
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      if (!this.models[model]) {
        throw new Error(`Model ${model} not found. Available: ${Object.keys(this.models).join(', ')}`);
      }

      console.log(`🤖 Running inference with ${model}: "${prompt.substring(0, 50)}..."`);

      // Select best available backend
      let result;
      
      // Priority: 1. Local GPU/Ollama, 2. Ollama Cloud, 3. Simulation
      if (this.ollamaAvailable && this.environment === 'local') {
        console.log('   Using local Ollama');
        result = await this.runLocalOllama(prompt, model, options);
      } else if (this.ollamaApiKey) {
        console.log('   Using Ollama Cloud');
        result = await this.runCloudOllama(prompt, model, options);
      } else {
        console.log('   Using simulation mode');
        result = await this.simulateInference(prompt, model, options);
      }

      return {
        success: true,
        model: model,
        prompt: prompt.substring(0, 100),
        output: result.output,
        tokens: result.tokens || 0,
        timing: result.timing || 0,
        backend: result.backend || 'simulated',
        gpu: this.gpuAvailable,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Inference error:', error);
      
      return {
        success: false,
        error: error.message,
        model: model,
        fallback: this.getFallbackResponse(prompt),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Run inference with local Ollama
   */
  async runLocalOllama(prompt, model, options) {
    const startTime = Date.now();
    const modelConfig = this.models[model];
    
    try {
      const { stdout, stderr } = await execPromise(
        `ollama run ${modelConfig.cloudModel.split(':')[0]} "${prompt.replace(/"/g, '\\"')}"`,
        { timeout: options.timeout || 30000 }
      );

      const executionTime = Date.now() - startTime;

      if (stderr) {
        console.warn('Ollama warning:', stderr);
      }

      return {
        output: stdout.trim(),
        tokens: Math.round(prompt.length / 4),
        timing: executionTime,
        backend: 'local-ollama'
      };

    } catch (error) {
      console.log('Local Ollama failed, falling back to cloud:', error.message);
      
      if (this.ollamaApiKey) {
        return this.runCloudOllama(prompt, model, options);
      }
      throw error;
    }
  }

  /**
   * Run inference with Ollama Cloud
   */
  async runCloudOllama(prompt, model, options) {
    const startTime = Date.now();
    const modelConfig = this.models[model];
    
    const {
      temperature = 0.7,
      maxTokens = 500,
      systemPrompt = 'You are CephasGM AI, an African-inspired artificial intelligence assistant.'
    } = options;

    try {
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: modelConfig.cloudModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: temperature,
            num_predict: maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama Cloud error: ${response.status}`);
      }

      const data = await response.json();
      const executionTime = Date.now() - startTime;

      return {
        output: data.message.content,
        tokens: data.usage?.total_tokens || Math.round(prompt.length / 4 + data.message.content.length / 4),
        timing: executionTime,
        backend: 'ollama-cloud'
      };

    } catch (error) {
      console.log('Ollama Cloud failed:', error.message);
      throw error;
    }
  }

  /**
   * Simulate inference for demo
   */
  async simulateInference(prompt, model, options) {
    const processingTime = Math.min(500 + prompt.length * 2, 3000);
    await this.simulateDelay(processingTime);

    const modelConfig = this.models[model];
    let output;

    if (modelConfig.type === 'code') {
      output = this.generateCodeResponse(prompt);
    } else if (modelConfig.type === 'embedding') {
      output = this.generateEmbeddingResponse(prompt);
    } else {
      output = this.generateTextResponse(prompt);
    }

    return {
      output: output,
      tokens: Math.round(prompt.length / 4),
      timing: processingTime,
      backend: 'simulated'
    };
  }

  /**
   * Generate text response for simulation
   */
  generateTextResponse(prompt) {
    const isApiKeyMissing = !this.ollamaApiKey && this.environment === 'render';
    
    if (isApiKeyMissing) {
      return `🔑 **Ollama Cloud API Key Required**

You're running on Render without a configured Ollama API key. To enable real AI inference:

1. Get your API key from https://ollama.com/account
2. Add it to your Render environment variables as OLLAMA_API_KEY
3. Redeploy the application

**Your prompt:** "${prompt.substring(0, 100)}..."

Once configured, you'll have access to models like Llama 3.2, Mistral, and CodeLlama through Ollama Cloud.`;
    }

    const responses = [
      `Based on your query about "${prompt.substring(0, 50)}", I can provide the following insights...\n\nThis is a simulated response. To get real AI-generated content, configure Ollama Cloud API key or run locally with GPU.`,
      
      `I understand you're asking about "${prompt.substring(0, 40)}". Currently running in simulation mode.\n\nTo enable GPU-accelerated inference:\n- Local: Install Ollama and pull models\n- Cloud: Add OLLAMA_API_KEY to environment`,
      
      `Thanks for your question. Without GPU access or Ollama Cloud configured, I'm providing a simulated response.\n\nFor production use, please set up one of the available inference backends.`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Generate code response for simulation
   */
  generateCodeResponse(prompt) {
    return `// Code generation for: ${prompt}
// Note: This is a simulated response. Configure Ollama Cloud for real code generation.

function example() {
  console.log("To generate real code, add OLLAMA_API_KEY to environment");
  
  return {
    status: "simulated",
    model: "codellama",
    prompt: "${prompt.substring(0, 50)}"
  };
}

// With Ollama Cloud configured, you'd get:
// - Real code generation
// - Code analysis and review
// - Bug detection
// - Optimization suggestions
// - Documentation generation`;
  }

  /**
   * Generate embedding response for simulation
   */
  generateEmbeddingResponse(prompt) {
    const dimensions = 1536;
    const sampleEmbedding = Array.from({ length: 5 }, () => (Math.random() * 2 - 1).toFixed(4));
    
    return `{
  "embedding": [${sampleEmbedding.join(', ')}... ${dimensions - 5} more dimensions],
  "dimensions": ${dimensions},
  "model": "nomic-embed-text",
  "note": "This is a simulated embedding. Real embeddings require Ollama Cloud API key or local Ollama with nomic-embed-text model.",
  "prompt": "${prompt.substring(0, 100)}"
}`;
  }

  /**
   * Get fallback response
   */
  getFallbackResponse(prompt) {
    return `I received your prompt: "${prompt.substring(0, 100)}". However, inference encountered an error. 

**Troubleshooting:**
1. If on Render: Add OLLAMA_API_KEY to environment
2. If local: Ensure Ollama is running (ollama serve)
3. Check that the model is pulled (ollama pull [model])

Current status: GPU=${this.gpuAvailable}, Local Ollama=${this.ollamaAvailable}, Cloud=${!!this.ollamaApiKey}`;
  }

  /**
   * Run batch inference on multiple prompts
   */
  async batchRun(prompts, model = 'llama3.2', options = {}) {
    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < prompts.length; i++) {
      console.log(`Batch ${i + 1}/${prompts.length}`);
      const result = await this.run(prompts[i], model, options);
      results.push(result);
    }

    return {
      success: true,
      batchSize: prompts.length,
      results,
      totalTime: Date.now() - startTime,
      averageTime: (Date.now() - startTime) / prompts.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if model is available
   */
  async isModelAvailable(model) {
    const modelConfig = this.models[model];
    if (!modelConfig) return false;

    // Cloud is always available if API key exists
    if (this.ollamaApiKey) return true;

    // Local check
    if (this.ollamaAvailable) {
      try {
        const { stdout } = await execPromise('ollama list');
        return stdout.includes(modelConfig.cloudModel.split(':')[0]);
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Pull a model (local only)
   */
  async pullModel(model) {
    if (this.environment !== 'local') {
      throw new Error('Can only pull models in local environment');
    }

    const modelConfig = this.models[model];
    if (!modelConfig) {
      throw new Error(`Model ${model} not found`);
    }

    console.log(`⬇️ Pulling model ${model}...`);
    
    return new Promise((resolve, reject) => {
      const process = spawn('ollama', ['pull', modelConfig.cloudModel.split(':')[0]]);
      
      process.stdout.on('data', (data) => {
        console.log(data.toString());
      });
      
      process.stderr.on('data', (data) => {
        console.error(data.toString());
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Model ${model} pulled successfully`);
          resolve({ success: true, model });
        } else {
          reject(new Error(`Failed to pull model ${model}`));
        }
      });
    });
  }

  /**
   * Get available models with status
   */
  async getAvailableModels() {
    const models = [];

    for (const [name, config] of Object.entries(this.models)) {
      models.push({
        name,
        type: config.type,
        size: config.size,
        available: await this.isModelAvailable(name),
        backends: {
          local: this.ollamaAvailable,
          cloud: !!this.ollamaApiKey,
          gpu: this.gpuAvailable
        }
      });
    }

    return models;
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      environment: this.environment,
      gpu: {
        available: this.gpuAvailable
      },
      ollama: {
        local: this.ollamaAvailable,
        cloud: !!this.ollamaApiKey
      },
      models: Object.keys(this.models).length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get GPU status
   */
  getGpuStatus() {
    return {
      available: this.gpuAvailable,
      ollamaLocal: this.ollamaAvailable,
      ollamaCloud: !!this.ollamaApiKey,
      environment: this.environment,
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
