/**
 * Video Generator - Create videos from text prompts
 */
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

class VideoGenerator {
  constructor() {
    this.providers = {
      'runwayml': {
        apiUrl: 'https://api.runwayml.com/v1/video',
        models: ['gen-2', 'gen-1']
      },
      'stable-video': {
        apiUrl: 'https://api.stability.ai/v2beta/stable-video',
        models: ['svd', 'svd-xt']
      }
    };
    
    this.outputDir = path.join(__dirname, '../../generated-videos');
    this.initOutputDir();
  }

  /**
   * Initialize output directory
   */
  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
      console.log('Video output directory initialized');
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
        fps = 24
      } = options;

      console.log(`Generating video: "${prompt.substring(0, 50)}..."`);

      // Route to appropriate provider
      let result;
      
      switch (provider) {
        case 'runwayml':
          result = await this.generateWithRunway(prompt, model, duration, resolution);
          break;
        case 'stable-video':
          result = await this.generateWithStableVideo(prompt, model, duration);
          break;
        default:
          result = await this.generateMockVideo(prompt, duration);
      }

      // Save video info
      const videoInfo = {
        id: this.generateId(),
        prompt: prompt,
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
        ...videoInfo
      };

    } catch (error) {
      console.error('Video generation error:', error);
      return {
        success: false,
        error: error.message,
        url: this.getFallbackVideoUrl(prompt)
      };
    }
  }

  /**
   * Generate with RunwayML
   */
  async generateWithRunway(prompt, model, duration, resolution) {
    const apiKey = config.runwayApiKey;
    
    if (!apiKey || apiKey === 'YOUR_RUNWAY_API_KEY') {
      return this.generateMockVideo(prompt, duration);
    }

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
      id: data.id
    };
  }

  /**
   * Generate with Stable Video
   */
  async generateWithStableVideo(prompt, model, duration) {
    const apiKey = config.stabilityApiKey;
    
    if (!apiKey) {
      return this.generateMockVideo(prompt, duration);
    }

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
      id: data.id
    };
  }

  /**
   * Generate mock video for demo
   */
  async generateMockVideo(prompt, duration) {
    // Simulate video generation
    await this.simulateDelay(3000);
    
    // Create a mock video URL (using placeholder)
    const videoId = this.generateId();
    const mockUrl = `https://storage.googleapis.com/cephasgm-demo/videos/${videoId}.mp4`;
    
    return {
      url: mockUrl,
      id: videoId
    };
  }

  /**
   * Get fallback video URL
   */
  getFallbackVideoUrl(prompt) {
    return `https://via.placeholder.com/1024x576.png?text=${encodeURIComponent(prompt.substring(0, 30))}`;
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
    // Mock status check
    await this.simulateDelay(500);
    
    return {
      id: videoId,
      status: 'completed',
      progress: 100
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
