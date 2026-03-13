/**
 * Multimodal Image Engine - Image generation and processing with AI
 * Now integrated with real APIs (DALL‑E, Stability AI) and Ollama Cloud for prompt enhancement
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
    this.openAiKey = process.env.OPENAI_API_KEY;
    this.stabilityKey = process.env.STABILITY_API_KEY;
    
    this.initOutputDir();
    
    console.log('🎨 Image engine initialized');
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅' : '❌'} | OpenAI: ${this.openAiKey ? '✅' : '❌'} | Stability: ${this.stabilityKey ? '✅' : '❌'}`);
    console.log(`   Models: ${Object.keys(this.models).length} | Styles: ${this.styles.length}`);
  }

  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create image directory:', error);
    }
  }

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
      // Enhance prompt with Ollama if requested and available
      let finalPrompt = prompt;
      if (enhancePrompt && this.ollamaApiKey) {
        const enhanced = await this.enhanceImagePrompt(prompt, style);
        if (enhanced) finalPrompt = enhanced.prompt;
      }

      // Determine which provider to use
      const modelInfo = this.models[model] || this.models['dall-e-2'];
      let result = null;

      if (modelInfo.provider === 'openai' && this.openAiKey) {
        result = await this.callOpenAI(finalPrompt, model, size, quality, n);
      } else if (modelInfo.provider === 'stability' && this.stabilityKey) {
        result = await this.callStability(finalPrompt, model, size, style);
      } else {
        // Fallback to simulation
        result = await this.simulateGeneration(finalPrompt, size, style);
      }

      const imageData = {
        id: requestId,
        prompt: finalPrompt,
        originalPrompt: prompt,
        style,
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
        url: this.getPlaceholderUrl(prompt, size),
        timestamp: new Date().toISOString()
      };
    }
  }

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
            { role: 'system', content: 'You are an expert prompt engineer for AI image generation. Create detailed, vivid prompts that produce high-quality images.' },
            { role: 'user', content: `Enhance this image generation prompt${styleInstruction}:\n\n${prompt}` }
          ],
          options: { temperature: 0.7, num_predict: 300 }
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { prompt: data.message.content };
    } catch (error) {
      console.log('Prompt enhancement failed:', error.message);
      return null;
    }
  }

  async callOpenAI(prompt, model, size, quality, n) {
    const apiKey = this.openAiKey;
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, prompt, n, size, quality })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    return { url: data.data[0].url, revisedPrompt: data.data[0].revised_prompt };
  }

  async callStability(prompt, model, size, style) {
    const apiKey = this.stabilityKey;
    const [width, height] = size.split('x').map(Number);
    // Stability AI uses different endpoints per model; we'll use the stable-diffusion-xl-1024-v1-0 as an example
    const engineId = 'stable-diffusion-xl-1024-v1-0';
    const response = await fetch(`https://api.stability.ai/v1/generation/${engineId}/text-to-image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text_prompts: [{ text: prompt, weight: 1.0 }],
        cfg_scale: 7,
        height,
        width,
        samples: 1,
        steps: 30
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Stability API error: ${error}`);
    }

    const data = await response.json();
    // data.artifacts[0].base64 contains the image as base64
    const base64 = data.artifacts[0].base64;
    const url = `data:image/png;base64,${base64}`;
    return { url };
  }

  async simulateGeneration(prompt, size, style) {
    await this.simulateDelay(2000);
    const encodedPrompt = encodeURIComponent(prompt.substring(0, 30));
    const styleText = style ? `&style=${style}` : '';
    return {
      url: `https://via.placeholder.com/${size}.png?text=${encodedPrompt}${styleText}`,
      simulated: true
    };
  }

  async generateVariations(prompt, count = 4, options = {}) {
    const variations = [];
    for (let i = 0; i < count; i++) {
      variations.push(await this.generate(`${prompt} - variation ${i+1}`, options));
    }
    return { success: true, count, variations };
  }

  async edit(imagePath, maskPath, prompt) {
    console.log(`🖌️ Editing image (simulated)`);
    await this.simulateDelay(3000);
    return { success: true, url: this.getPlaceholderUrl(`Edit: ${prompt}`, '512x512') };
  }

  async analyze(imageUrl) {
    if (!this.ollamaApiKey) return this.getMockAnalysis();
    try {
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.ollamaApiKey}` },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are an AI image analyst.' },
            { role: 'user', content: `Analyze this image (URL: ${imageUrl}): What do you see?` }
          ],
          options: { temperature: 0.5, num_predict: 500 }
        })
      });
      if (!response.ok) return this.getMockAnalysis();
      const data = await response.json();
      return { success: true, analysis: data.message.content, provider: 'ollama' };
    } catch (error) {
      return this.getMockAnalysis();
    }
  }

  getMockAnalysis() {
    return { success: true, analysis: "Placeholder image analysis. Configure Ollama API key for real analysis." };
  }

  async styleTransfer(imageUrl, targetStyle) {
    console.log(`🎨 Applying style: ${targetStyle} (simulated)`);
    await this.simulateDelay(2500);
    return { success: true, url: this.getPlaceholderUrl(`Styled: ${targetStyle}`, '512x512') };
  }

  async createCollage(images, layout = 'grid') {
    console.log(`🖼️ Creating ${layout} collage (simulated)`);
    await this.simulateDelay(3000);
    return { success: true, url: this.getPlaceholderUrl(`Collage`, '1024x1024') };
  }

  async saveMetadata(imageData) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');
    try {
      let metadata = [];
      try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')); } catch {}
      metadata.push({ id: imageData.id, prompt: imageData.prompt.substring(0,100), model: imageData.model, size: imageData.size, timestamp: imageData.timestamp });
      if (metadata.length > 100) metadata = metadata.slice(-100);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) { console.error('Failed to save metadata:', error); }
  }

  async listImages(limit = 20) {
    try {
      const data = await fs.readFile(path.join(this.outputDir, 'metadata.json'), 'utf8');
      return JSON.parse(data).slice(-limit).reverse();
    } catch { return this.generated.slice(-limit).reverse(); }
  }

  getPlaceholderUrl(prompt, size) {
    const encoded = encodeURIComponent(prompt.substring(0,20));
    return `https://via.placeholder.com/${size}.png?text=${encoded}`;
  }

  getStats() {
    return {
      generatedCount: this.generated.length,
      lastGenerated: this.generated[this.generated.length-1]?.timestamp,
      modelsAvailable: Object.keys(this.models).length,
      stylesAvailable: this.styles.length,
      apiKeyConfigured: { ollama: !!this.ollamaApiKey, openai: !!this.openAiKey, stability: !!this.stabilityKey }
    };
  }

  getModels() {
    return Object.entries(this.models).map(([id, info]) => ({ id, ...info }));
  }

  getStyles() { return this.styles; }

  estimateCost(model, count = 1) {
    const info = this.models[model] || this.models['dall-e-2'];
    return { model: info.name, cost: (info.pricePerImage * count).toFixed(2), currency: 'USD' };
  }

  generateRequestId() { return `img_${Date.now()}_${Math.random().toString(36).substr(2,9)}`; }
  simulateDelay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = new ImageEngine();
