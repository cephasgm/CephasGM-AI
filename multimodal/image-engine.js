/**
 * Image Engine - Generate and process images
 */
const fetch = require("node-fetch");
const fs = require("fs").promises;
const path = require("path");

class ImageEngine {
  constructor() {
    this.models = {
      'dall-e-2': { provider: 'openai', sizes: ['256x256', '512x512', '1024x1024'] },
      'dall-e-3': { provider: 'openai', sizes: ['1024x1024', '1792x1024', '1024x1792'] },
      'stable-diffusion': { provider: 'stability', sizes: ['512x512', '768x768', '1024x1024'] }
    };
    
    this.generatedImages = [];
    this.outputDir = path.join(__dirname, '../generated-images');
    this.initOutputDir();
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

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }

    console.log(`🎨 Image engine generating with ${model}: "${prompt.substring(0, 50)}..."`);

    try {
      const apiKey = process.env.OPENAI_KEY;
      
      let result;
      
      if (apiKey && apiKey !== 'YOUR_OPENAI_API_KEY') {
        result = await this.callOpenAI(prompt, model, size, quality, n);
      } else {
        result = await this.simulateGeneration(prompt, size);
      }

      // Store metadata
      const imageData = {
        id: this.generateId(),
        prompt,
        ...result,
        timestamp: new Date().toISOString()
      };
      
      this.generatedImages.push(imageData);
      
      // Save metadata
      await this.saveMetadata(imageData);

      return imageData;

    } catch (error) {
      console.error('Image generation failed:', error);
      
      return {
        success: false,
        error: error.message,
        url: this.getPlaceholderUrl(prompt, size)
      };
    }
  }

  /**
   * Call OpenAI DALL-E API
   */
  async callOpenAI(prompt, model, size, quality, n) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.OPENAI_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        n: n,
        size: size,
        quality: quality
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      url: data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt,
      model: model,
      size: size
    };
  }

  /**
   * Simulate image generation for demo
   */
  async simulateGeneration(prompt, size) {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create a placeholder URL with the prompt
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30));
    const [width, height] = size.split('x').map(Number);
    
    const url = `https://via.placeholder.com/${size}.png?text=${encodedPrompt}`;
    
    return {
      success: true,
      url: url,
      model: 'simulated',
      size: size,
      simulated: true
    };
  }

  /**
   * Get placeholder URL on error
   */
  getPlaceholderUrl(prompt, size) {
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 20));
    return `https://via.placeholder.com/${size}.png?text=Error:+${encodedPrompt}`;
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
   * Edit an image (DALL-E 2 edits)
   */
  async edit(imagePath, maskPath, prompt, options = {}) {
    // This would use the OpenAI edits endpoint
    // For demo, return placeholder
    return {
      success: true,
      url: this.getPlaceholderUrl(`Edit: ${prompt}`, '512x512'),
      edited: true
    };
  }

  /**
   * Generate image variation
   */
  async createVariation(imagePath, options = {}) {
    // This would use the OpenAI variations endpoint
    return this.generate(`Variation of existing image`, options);
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
      
      // Keep last 100 images
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
      return this.generatedImages.slice(-limit).reverse();
    }
  }

  /**
   * Download image to local storage
   */
  async downloadImage(url, filename) {
    try {
      const response = await fetch(url);
      const buffer = await response.buffer();
      
      const filepath = path.join(this.outputDir, filename || `image_${Date.now()}.png`);
      await fs.writeFile(filepath, buffer);
      
      return filepath;
      
    } catch (error) {
      console.error('Failed to download image:', error);
      return null;
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      generatedCount: this.generatedImages.length,
      lastGenerated: this.generatedImages[this.generatedImages.length - 1]?.timestamp
    };
  }
}

module.exports = new ImageEngine();
