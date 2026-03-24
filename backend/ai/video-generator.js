/**
 * Video Generator - Create videos from text prompts
 * Now integrated with Ollama Cloud for script generation and planning
 * Fixed to return a real video URL when using mock mode.
 */
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');

class VideoGenerator {
  constructor() {
    this.providers = {
      'runwayml': {
        name: 'RunwayML',
        apiUrl: 'https://api.runwayml.com/v1/video',
        models: ['gen-2', 'gen-1']
      },
      'stable-video': {
        name: 'Stability AI',
        apiUrl: 'https://api.stability.ai/v2beta/stable-video',
        models: ['svd', 'svd-xt']
      },
      'luma': {
        name: 'Luma Dream Machine',
        apiUrl: 'https://api.lumalabs.ai/v1/video',
        models: ['dream-machine']
      }
    };
    
    this.outputDir = path.join(__dirname, '../../generated-videos');
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.initOutputDir();
    
    console.log('🎬 Video generator initialized with Ollama Cloud');
    console.log(`   API Key: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
  }

  /**
   * Initialize output directory
   */
  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log('   Output directory:', this.outputDir);
    } catch (error) {
      console.error('Failed to create video directory:', error);
    }
  }

  /**
   * Create video from prompt
   */
  async create(prompt, options = {}) {
    try {
      if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
      }

      const {
        provider = 'runwayml',
        model = 'gen-2',
        duration = 5,
        resolution = '1024x576',
        fps = 24,
        enhancePrompt = true
      } = options;

      console.log(`🎬 Generating video: "${prompt.substring(0, 50)}..."`);

      // Enhance prompt with AI if requested and API key exists
      let enhancedPrompt = prompt;
      let script = null;
      
      if (enhancePrompt && this.ollamaApiKey) {
        const enhancement = await this.enhanceVideoPrompt(prompt, duration);
        enhancedPrompt = enhancement.prompt;
        script = enhancement.script;
        console.log('✨ Prompt enhanced with AI');
      }

      // Route to appropriate provider
      let result;
      
      switch (provider) {
        case 'runwayml':
          result = await this.generateWithRunway(enhancedPrompt, model, duration, resolution);
          break;
        case 'stable-video':
          result = await this.generateWithStableVideo(enhancedPrompt, model, duration);
          break;
        case 'luma':
          result = await this.generateWithLuma(enhancedPrompt, model, duration);
          break;
        default:
          result = await this.generateMockVideo(enhancedPrompt, duration, resolution);
      }

      // Save video info
      const videoInfo = {
        id: this.generateId(),
        prompt: prompt,
        enhancedPrompt: enhancedPrompt,
        script: script,
        url: result.url,
        duration: duration,
        resolution: resolution,
        provider: provider,
        model: model,
        timestamp: new Date().toISOString()
      };

      // Save metadata
      await this.saveMetadata(videoInfo);

      return {
        success: true,
        ...videoInfo,
        message: result.message || 'Video generation initiated'
      };

    } catch (error) {
      console.error('Video generation error:', error);
      return {
        success: false,
        error: error.message,
        url: this.getFallbackVideoUrl(prompt, options.resolution || '1024x576'),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Enhance video prompt using Ollama
   */
  async enhanceVideoPrompt(prompt, duration) {
    try {
      if (!this.ollamaApiKey) {
        return { prompt, script: null };
      }

      const systemPrompt = `You are a professional video script writer and prompt engineer. Create detailed, visually descriptive video prompts and optionally a script.`;

      const userPrompt = `Create a video generation prompt for: "${prompt}". Duration: ${duration} seconds.
      
Return a JSON object with:
1. enhanced_prompt: A detailed visual description for AI video generation
2. script: Optional shot-by-shot script (if applicable)`;

      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          options: {
            temperature: 0.7,
            format: 'json'
          }
        })
      });

      if (!response.ok) {
        return { prompt, script: null };
      }

      const data = await response.json();
      
      try {
        const parsed = JSON.parse(data.message.content);
        return {
          prompt: parsed.enhanced_prompt || prompt,
          script: parsed.script || null
        };
      } catch {
        return { prompt, script: null };
      }

    } catch (error) {
      console.log('Prompt enhancement failed:', error.message);
      return { prompt, script: null };
    }
  }

  /**
   * Generate with RunwayML
   */
  async generateWithRunway(prompt, model, duration, resolution) {
    const apiKey = config.runwayApiKey;
    
    if (!apiKey || apiKey === 'YOUR_RUNWAY_API_KEY') {
      return this.generateMockVideo(prompt, duration, resolution);
    }

    try {
      const response = await fetch('https://api.runwayml.com/v1/video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          model: model,
          duration: duration,
          resolution: resolution
        })
      });

      if (!response.ok) {
        throw new Error(`RunwayML API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        url: data.url || data.video_url,
        id: data.id,
        message: 'Video generation started'
      };

    } catch (error) {
      console.error('RunwayML error:', error);
      return this.generateMockVideo(prompt, duration, resolution);
    }
  }

  /**
   * Generate with Stable Video
   */
  async generateWithStableVideo(prompt, model, duration) {
    const apiKey = config.stabilityApiKey;
    
    if (!apiKey) {
      return this.generateMockVideo(prompt, duration, '1024x576');
    }

    try {
      const response = await fetch('https://api.stability.ai/v2beta/stable-video/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          model: model,
          duration: duration
        })
      });

      if (!response.ok) {
        throw new Error(`Stable Video API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        url: data.video_url,
        id: data.id,
        message: 'Video generation started'
      };

    } catch (error) {
      console.error('Stable Video error:', error);
      return this.generateMockVideo(prompt, duration, '1024x576');
    }
  }

  /**
   * Generate with Luma Dream Machine
   */
  async generateWithLuma(prompt, model, duration) {
    const apiKey = config.lumaApiKey;
    
    if (!apiKey) {
      return this.generateMockVideo(prompt, duration, '1024x576');
    }

    try {
      const response = await fetch('https://api.lumalabs.ai/v1/video', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          duration: duration
        })
      });

      if (!response.ok) {
        throw new Error(`Luma API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        url: data.url,
        id: data.id,
        message: 'Video generation started'
      };

    } catch (error) {
      console.error('Luma error:', error);
      return this.generateMockVideo(prompt, duration, '1024x576');
    }
  }

  /**
   * Generate mock video for demo – now returns a real video URL
   */
  async generateMockVideo(prompt, duration, resolution) {
    // Simulate a realistic video generation delay (3-5 seconds)
    await this.simulateDelay(4000);
    
    const videoId = this.generateId();
    
    // Use a publicly accessible sample video from W3Schools (small, 5 seconds)
    // This ensures the frontend receives a valid .mp4 file.
    const sampleVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
    
    // Optionally, you could add a query parameter to make it look "unique"
    const url = `${sampleVideoUrl}?id=${videoId}`;
    
    return {
      url: url,
      id: videoId,
      message: 'Video generated (sample video) – add API keys for real AI videos',
      duration: duration,
      resolution: resolution
    };
  }

  /**
   * Get fallback video URL
   */
  getFallbackVideoUrl(prompt, resolution) {
    // Still a video, but static
    return 'https://www.w3schools.com/html/mov_bbb.mp4';
  }

  /**
   * Save video metadata
   */
  async saveMetadata(videoInfo) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');
    
    try {
      let metadata = [];
      
      try {
        const existing = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(existing);
      } catch {
        // No existing metadata
      }
      
      metadata.push(videoInfo);
      
      // Keep last 100 entries
      if (metadata.length > 100) {
        metadata = metadata.slice(-100);
      }
      
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      
    } catch (error) {
      console.error('Failed to save metadata:', error);
    }
  }

  /**
   * Get generation status
   */
  async getStatus(videoId) {
    // Simulate status check
    await this.simulateDelay(500);
    
    const statuses = ['queued', 'processing', 'completed'];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    
    return {
      id: videoId,
      status: randomStatus,
      progress: randomStatus === 'completed' ? 100 : Math.floor(Math.random() * 80) + 10,
      estimatedRemaining: randomStatus === 'completed' ? 0 : Math.floor(Math.random() * 30) + 10
    };
  }

  /**
   * List generated videos
   */
  async listVideos(limit = 10) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');
    
    try {
      const data = await fs.readFile(metadataPath, 'utf8');
      const videos = JSON.parse(data);
      
      return videos.slice(-limit).reverse();
      
    } catch (error) {
      console.error('Failed to list videos:', error);
      return [];
    }
  }

  /**
   * Generate video script with AI
   */
  async generateScript(topic, duration = 30) {
    try {
      if (!this.ollamaApiKey) {
        return this.getMockScript(topic, duration);
      }

      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are a professional video script writer. Create engaging, well-structured video scripts.' },
            { role: 'user', content: `Create a ${duration}-second video script about: ${topic}. Include visual descriptions and narration.` }
          ],
          options: { temperature: 0.7 }
        })
      });

      if (!response.ok) {
        return this.getMockScript(topic, duration);
      }

      const data = await response.json();
      
      return {
        success: true,
        topic: topic,
        duration: duration,
        script: data.message.content,
        provider: 'ollama-cloud',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Script generation failed:', error);
      return this.getMockScript(topic, duration);
    }
  }

  /**
   * Get mock script for fallback
   */
  getMockScript(topic, duration) {
    return {
      success: true,
      topic: topic,
      duration: duration,
      script: `[SCRIPT FOR: ${topic}]

INTRO (0:00-0:05)
Visual: Opening shot related to ${topic}
Narrator: Welcome to this video about ${topic}.

MAIN CONTENT (0:05-${duration-5})
Visual: Key concepts and examples
Narrator: ${topic} is an important subject in modern technology...

OUTRO (${duration-5}-${duration})
Visual: Closing thoughts and call to action
Narrator: Thank you for watching!`,
      provider: 'mock',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get available providers
   */
  getProviders() {
    return Object.entries(this.providers).map(([id, info]) => ({
      id,
      name: info.name,
      models: info.models
    }));
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return 'vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new VideoGenerator();
