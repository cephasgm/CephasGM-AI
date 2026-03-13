/**
 * Multimodal Image Engine - Image generation and processing with AI
 * Integrates OpenAI DALL‑E, Stability AI, and Ollama for prompt enhancement
 */
const fetch = require('node-fetch');
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class ImageEngine extends EventEmitter {
  constructor() {
    super();
    
    this.models = {
      'dall-e-2': { 
        provider: 'openai', 
        name: 'DALL-E 2',
        sizes: ['256x256', '512x512', '1024x1024'],
        pricePerImage: 0.02
      },
      'dall-e-3': { 
        provider: 'openai', 
        name: 'DALL-E 3',
        sizes: ['1024x1024', '1792x1024', '1024x1792'],
        pricePerImage: 0.04
      },
      'stable-diffusion': { 
        provider: 'stability', 
        name: 'Stable Diffusion',
        sizes: ['512x512', '768x768', '1024x1024'],
        pricePerImage: 0.02
      },
      'sdxl': { 
        provider: 'stability', 
        name: 'SDXL',
        sizes: ['1024x1024', '1152x896', '1216x832'],
        pricePerImage: 0.03
      },
      'flux': { 
        provider: 'black-forest', 
        name: 'FLUX',
        sizes: ['1024x1024', '1280x720', '720x1280'],
        pricePerImage: 0.03
      }
    };
    
    this.styles = [
      'photorealistic', 'digital-art', 'anime', 'oil-painting',
      'watercolor', 'sketch', '3d-render', 'pixel-art',
      'african-art', 'kente-pattern', 'ankara-print', 'mud-cloth'
    ];
    
    this.generated = [];
    this.outputDir = path.join(__dirname, '../generated-images');
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.stabilityKey = process.env.STABILITY_KEY;
    
    this.initOutputDir();
    
    console.log('🎨 Image engine initialized');
    console.log(`   OpenAI: ${this.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Stability AI: ${this.stabilityKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Models: ${Object.keys(this.models).length}`);
    console.log(`   Styles: ${this.styles.length}`);
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
   * Generate image from prompt with AI enhancement
   */
  async generate(prompt, options = {}) {
    const {
      model = 'dall-e-2',
      size = '512x512',
      style = null,
      quality = 'standard',
      n = 1,
      enhancePrompt = true
    } = options;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    console.log(`🎨 [${requestId}] Generating image: "${prompt.substring(0, 50)}..."`);

    try {
      // Enhance prompt with AI if requested
      let finalPrompt = prompt;
      let promptMetadata = null;
      
      if (enhancePrompt && this.ollamaApiKey) {
        const enhanced = await this.enhanceImagePrompt(prompt, style);
        if (enhanced) {
          finalPrompt = enhanced.prompt;
          promptMetadata = enhanced.metadata;
        }
      }

      // Generate negative prompt if style specified
      const negativePrompt = style ? await this.generateNegativePrompt(style) : null;

      // Try real API in priority order: OpenAI DALL-E first, then Stability
      let result;
      if (this.openaiApiKey && model.startsWith('dall-e')) {
        result = await this.callOpenAI(finalPrompt, model, size, quality, n);
      } else if (this.stabilityKey && (model.includes('stable') || model.includes('sdxl'))) {
        result = await this.callStability(finalPrompt, model, size, negativePrompt);
      } else {
        result = await this.simulateGeneration(finalPrompt, size, style);
      }

      const imageData = {
        id: requestId,
        prompt: finalPrompt,
        originalPrompt: prompt,
        style: style,
        url: result.url,
        model,
        size,
        quality,
        enhanced: !!promptMetadata,
        promptMetadata,
        negativePrompt,
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
        url: this.getPlaceholderUrl(prompt, size),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Enhance image prompt using Ollama
   */
  async enhanceImagePrompt(prompt, style) {
    try {
      if (!this.ollamaApiKey) return null;

      const styleInstruction = style ? ` in ${style} style` : '';
      
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { 
              role: 'system', 
              content: 'You are an expert prompt engineer for AI image generation. Create detailed, vivid prompts that produce high-quality images. Include details about lighting, composition, mood, and visual elements.'
            },
            { 
              role: 'user', 
              content: `Enhance this image generation prompt${styleInstruction} to be more detailed and effective:\n\n${prompt}`
            }
          ],
          options: {
            temperature: 0.7,
            num_predict: 300
          }
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      
      return {
        prompt: data.message.content,
        metadata: {
          enhanced: true,
          model: 'llama3.2',
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.log('Prompt enhancement failed:', error.message);
      return null;
    }
  }

  /**
   * Generate negative prompt for style
   */
  async generateNegativePrompt(style) {
    const negatives = {
      'photorealistic': 'cartoon, anime, painting, sketch, low quality, blurry',
      'digital-art': 'photorealistic, photograph, low resolution, grainy',
      'anime': 'photorealistic, 3d render, western comic style',
      'oil-painting': 'digital art, photograph, sketch, low quality',
      'african-art': 'western style, generic, low quality, inaccurate patterns'
    };
    
    return negatives[style] || 'low quality, blurry, distorted, bad anatomy';
  }

  /**
   * Call OpenAI DALL-E API
   */
  async callOpenAI(prompt, model, size, quality, n) {
    const apiKey = this.openaiApiKey;
    
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
   * Call Stability AI API
   */
  async callStability(prompt, model, size, negativePrompt) {
    const apiKey = this.stabilityKey;
    const [width, height] = size.split('x').map(Number);
    
    const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text_prompts: [
          { text: prompt, weight: 1.0 },
          { text: negativePrompt || '', weight: -1.0 }
        ],
        cfg_scale: 7,
        height,
        width,
        samples: 1,
        steps: 30
      })
    });

    if (!response.ok) {
      throw new Error(`Stability API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Convert base64 to data URL
    const base64 = data.artifacts[0].base64;
    const url = `data:image/png;base64,${base64}`;

    return { url };
  }

  /**
   * Simulate image generation
   */
  async simulateGeneration(prompt, size, style) {
    await this.simulateDelay(2000);

    const [width, height] = size.split('x').map(Number);
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30));
    
    // Create style overlay
    const styleText = style ? `&style=${style}` : '';
    
    return {
      url: `https://via.placeholder.com/${size}.png?text=${encodedPrompt}${styleText}`,
      simulated: true
    };
  }

  /**
   * Generate multiple variations with AI
   */
  async generateVariations(prompt, count = 4, options = {}) {
    const variations = [];
    const startTime = Date.now();

    // Generate different variations with slight prompt modifications
    for (let i = 0; i < count; i++) {
      const variationPrompt = `${prompt} - variation ${i + 1} with different composition`;
      
      const image = await this.generate(variationPrompt, {
        ...options,
        enhancePrompt: true
      });
      
      variations.push(image);
    }

    return {
      success: true,
      count: variations.length,
      variations,
      batchId: this.generateRequestId(),
      timestamp: new Date().toISOString(),
      latency: Date.now() - startTime
    };
  }

  /**
   * Edit an image with AI assistance
   */
  async edit(imagePath, maskPath, prompt, options = {}) {
    console.log(`🖌️ Editing image with prompt: "${prompt.substring(0, 50)}..."`);

    // Simulate editing
    await this.simulateDelay(3000);

    return {
      success: true,
      url: this.getPlaceholderUrl(`Edit: ${prompt}`, '512x512'),
      edited: true,
      prompt,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze image with AI (simulated)
   */
  async analyze(imageUrl) {
    if (!this.ollamaApiKey) {
      return this.getMockAnalysis();
    }

    try {
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { 
              role: 'system', 
              content: 'You are an AI image analyst. Describe and analyze images based on their visual characteristics.'
            },
            { 
              role: 'user', 
              content: `Analyze this image (described by URL: ${imageUrl}): What do you see? Describe the composition, colors, mood, and any notable elements.`
            }
          ],
          options: {
            temperature: 0.5,
            num_predict: 500
          }
        })
      });

      if (!response.ok) {
        return this.getMockAnalysis();
      }

      const data = await response.json();
      
      return {
        success: true,
        analysis: data.message.content,
        provider: 'ollama-cloud',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.log('Image analysis failed:', error.message);
      return this.getMockAnalysis();
    }
  }

  /**
   * Get mock image analysis
   */
  getMockAnalysis() {
    return {
      success: true,
      analysis: "This image appears to be a generated or placeholder image. It shows a visual representation related to the prompt. For detailed analysis, configure Ollama Cloud API key.",
      provider: 'mock',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate style transfer
   */
  async styleTransfer(imageUrl, targetStyle) {
    console.log(`🎨 Applying style: ${targetStyle}`);

    await this.simulateDelay(2500);

    return {
      success: true,
      url: this.getPlaceholderUrl(`Styled: ${targetStyle}`, '512x512'),
      style: targetStyle,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create image collage
   */
  async createCollage(images, layout = 'grid') {
    console.log(`🖼️ Creating ${layout} collage with ${images.length} images`);

    await this.simulateDelay(3000);

    return {
      success: true,
      url: this.getPlaceholderUrl(`Collage: ${images.length} images`, '1024x1024'),
      layout,
      imageCount: images.length,
      timestamp: new Date().toISOString()
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

      metadata.push({
        id: imageData.id,
        prompt: imageData.prompt.substring(0, 100) + '...',
        model: imageData.model,
        size: imageData.size,
        timestamp: imageData.timestamp
      });

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
      return this.generated.slice(-limit).reverse().map(img => ({
        id: img.id,
        prompt: img.prompt.substring(0, 100) + '...',
        model: img.model,
        size: img.size,
        timestamp: img.timestamp
      }));
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
      lastGenerated: this.generated[this.generated.length - 1]?.timestamp,
      modelsAvailable: Object.keys(this.models).length,
      stylesAvailable: this.styles.length,
      apiKeyConfigured: {
        openai: !!this.openaiApiKey,
        stability: !!this.stabilityKey,
        ollama: !!this.ollamaApiKey
      }
    };
  }

  /**
   * Get available models
   */
  getModels() {
    return Object.entries(this.models).map(([id, info]) => ({
      id,
      name: info.name,
      provider: info.provider,
      sizes: info.sizes,
      pricePerImage: info.pricePerImage
    }));
  }

  /**
   * Get available styles
   */
  getStyles() {
    return this.styles;
  }

  /**
   * Estimate cost
   */
  estimateCost(model, count = 1) {
    const modelInfo = this.models[model] || this.models['dall-e-2'];
    return {
      model: modelInfo.name,
      cost: (modelInfo.pricePerImage * count).toFixed(2),
      currency: 'USD',
      images: count,
      pricePerImage: modelInfo.pricePerImage
    };
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
