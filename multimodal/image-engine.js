/**
 * Multimodal Image Engine - Image generation and processing
 */
const fetch = require('node-fetch');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ImageEngine extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'dall-e-2': { provider: 'openai', sizes: ['256x256', '512x512', '1024x1024'] },
      'dall-e-3': { provider: 'openai', sizes: ['1024x1024', '1792x1024', '1024x1792'] },
      'stable-diffusion': { provider: 'stability', sizes: ['512x512', '768x768', '1024x1024'] }
    };
    
    this.generated = [];
    this.outputDir = path.join(__dirname, '../generated-images');
    
    this.initOutputDir();
    
    console.log('🎨 Image engine initialized');
  }

  /**
   * Initialize output directory
   */
  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create image directory:', error);
    }
  }

  /**
   * Generate image from prompt
   */
  async generate(prompt, options = {}) {
    const {
      model = 'dall-e-2',
      size = '512x512',
      quality = 'standard',
      n = 1
    } = options;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    console.log(`🎨 [${requestId}] Generating image: "${prompt.substring(0, 50)}..."`);

    try {
      let result;

      if (process.env.OPENAI_KEY && process.env.OPENAI_KEY !== 'YOUR_OPENAI_KEY') {
        result = await this.callOpenAI(prompt, model, size, quality, n);
      } else {
        result = await this.simulateGeneration(prompt, size);
      }

      const imageData = {
        id: requestId,
        prompt,
        url: result.url,
        model,
        size,
        quality,
        timestamp: new Date().toISOString()
      };

      this.generated.push(imageData);
      await this.saveMetadata(imageData);

      this.emit('imageGenerated', { requestId, model });

      return {
        success: true,
        ...imageData,
        latency: Date.now() - startTime
      };

    } catch (error) {
      console.error('Image generation failed:', error);

      return {
        success: false,
        requestId,
        error: error.message,
        url: this.getPlaceholderUrl(prompt, size)
      };
    }
  }

  /**
   * Call OpenAI DALL-E API
   */
  async callOpenAI(prompt, model, size, quality, n) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        n,
        size,
        quality
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();

    return {
      url: data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt
    };
  }

  /**
   * Simulate image generation
   */
  async simulateGeneration(prompt, size) {
    await this.simulateDelay(1500);

    const [width, height] = size.split('x').map(Number);
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30));

    return {
      url: `https://via.placeholder.com/${size}.png?text=${encodedPrompt}`,
      simulated: true
    };
  }

  /**
   * Generate multiple images
   */
  async generateVariations(prompt, count = 4, options = {}) {
    const images = [];

    for (let i = 0; i < count; i++) {
      const image = await this.generate(prompt, {
        ...options,
        prompt: `${prompt} (variation ${i + 1})`
      });
      images.push(image);
    }

    return images;
  }

  /**
   * Edit an image
   */
  async edit(imagePath, maskPath, prompt, options = {}) {
    // Placeholder for image editing
    return {
      success: true,
      url: this.getPlaceholderUrl(`Edit: ${prompt}`, '512x512'),
      edited: true
    };
  }

  /**
   * Save image metadata
   */
  async saveMetadata(imageData) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');

    try {
      let metadata = [];

      try {
        const existing = await fs.readFile(metadataPath, 'utf8');
        metadata = JSON.parse(existing);
      } catch {
        // No existing metadata
      }

      metadata.push(imageData);

      if (metadata.length > 100) {
        metadata = metadata.slice(-100);
      }

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    } catch (error) {
      console.error('Failed to save metadata:', error);
    }
  }

  /**
   * List generated images
   */
  async listImages(limit = 20) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');

    try {
      const data = await fs.readFile(metadataPath, 'utf8');
      const images = JSON.parse(data);
      return images.slice(-limit).reverse();
    } catch {
      return this.generated.slice(-limit).reverse();
    }
  }

  /**
   * Get placeholder URL
   */
  getPlaceholderUrl(prompt, size) {
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 20));
    return `https://via.placeholder.com/${size}.png?text=${encodedPrompt}`;
  }

  /**
   * Get engine stats
   */
  getStats() {
    return {
      generatedCount: this.generated.length,
      lastGenerated: this.generated[this.generated.length - 1]?.timestamp
    };
  }

  /**
   * Get available models
   */
  getModels() {
    return Object.keys(this.models).map(name => ({
      name,
      provider: this.models[name].provider,
      sizes: this.models[name].sizes
    }));
  }

  /**
   * Generate request ID
   */
  generateRequestId() {
    return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new ImageEngine();
