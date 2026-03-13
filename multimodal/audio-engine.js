/**
 * Multimodal Audio Engine - Speech synthesis, recognition, and AI audio processing
 * Now with real TTS via ElevenLabs (optional) and Ollama Cloud integration
 */
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

class AudioEngine extends EventEmitter {
  constructor() {
    super();
    
    this.voices = [
      { id: 'african-female-1', name: 'Amara', language: 'en', gender: 'female', accent: 'west-african' },
      { id: 'african-male-1', name: 'Kwame', language: 'en', gender: 'male', accent: 'west-african' },
      { id: 'african-female-2', name: 'Zuri', language: 'en', gender: 'female', accent: 'east-african' },
      { id: 'african-male-2', name: 'Jabari', language: 'en', gender: 'male', accent: 'east-african' },
      { id: 'standard-female', name: 'Emma', language: 'en', gender: 'female', accent: 'american' },
      { id: 'standard-male', name: 'James', language: 'en', gender: 'male', accent: 'british' }
    ];
    
    this.generated = [];
    this.outputDir = path.join(__dirname, '../generated-audio');
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    this.elevenLabsVoices = [];
    
    this.initOutputDir();
    if (this.elevenLabsKey) this.fetchElevenLabsVoices();
    
    console.log('🔊 Audio engine initialized');
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅' : '❌'} | ElevenLabs: ${this.elevenLabsKey ? '✅' : '❌'}`);
  }

  async fetchElevenLabsVoices() {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': this.elevenLabsKey }
      });
      if (res.ok) {
        const data = await res.json();
        this.elevenLabsVoices = data.voices.map(v => ({
          id: v.voice_id,
          name: v.name,
          language: 'en',
          gender: v.labels?.gender || 'unknown',
          accent: v.labels?.accent || 'unknown',
          provider: 'elevenlabs'
        }));
        console.log(`   Loaded ${this.elevenLabsVoices.length} ElevenLabs voices`);
      }
    } catch (e) {
      console.log('   ElevenLabs voices unavailable:', e.message);
    }
  }

  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create audio directory:', error);
    }
  }

  async generate(text, options = {}) {
    const {
      voice = 'african-female-1',
      speed = 1.0,
      pitch = 1.0,
      format = 'mp3',
      enhanceScript = true
    } = options;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    console.log(`🔊 [${requestId}] Generating audio: "${text.substring(0, 50)}..."`);

    try {
      // Enhance script with Ollama if requested
      let finalText = text;
      if (enhanceScript && this.ollamaApiKey) {
        const enhanced = await this.enhanceAudioScript(text, voice);
        if (enhanced) finalText = enhanced.script;
      }

      // Determine which TTS provider to use
      let audioUrl = null;
      let provider = 'simulated';
      const voiceConfig = this.voices.find(v => v.id === voice) || this.voices[0];

      if (this.elevenLabsKey) {
        // Use ElevenLabs
        const elevenVoice = this.elevenLabsVoices.find(v => v.name.toLowerCase().includes(voiceConfig.gender)) || this.elevenLabsVoices[0];
        if (elevenVoice) {
          audioUrl = await this.generateElevenLabs(finalText, elevenVoice.id, speed);
          provider = 'elevenlabs';
        }
      }

      if (!audioUrl) {
        // Fallback: simulated audio (placeholder)
        audioUrl = this.getAudioUrl(requestId, format);
      }

      const audioDuration = this.estimateDuration(finalText, speed);
      const audioData = {
        id: requestId,
        text: finalText,
        originalText: text,
        voice: voiceConfig,
        speed,
        pitch,
        format,
        duration: audioDuration,
        url: audioUrl,
        provider,
        timestamp: new Date().toISOString()
      };

      this.generated.push(audioData);
      await this.saveMetadata(audioData);
      this.emit('audioGenerated', { requestId, duration: audioData.duration });

      return {
        success: true,
        ...audioData,
        latency: Date.now() - startTime
      };

    } catch (error) {
      console.error('Audio generation failed:', error);
      return { success: false, requestId, error: error.message };
    }
  }

  async generateElevenLabs(text, voiceId, speed) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.5, speed }
        })
      });

      if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
      
      const audioBuffer = await response.buffer();
      const filename = `audio_${Date.now()}.mp3`;
      const filePath = path.join(this.outputDir, filename);
      await fs.writeFile(filePath, audioBuffer);
      
      // Return a publicly accessible URL (you'd need to serve this folder via static route)
      // For now, return a data URL or a placeholder
      return `/generated-audio/${filename}`; // Assumes you serve static files from this folder
    } catch (e) {
      console.error('ElevenLabs generation failed:', e);
      return null;
    }
  }

  async enhanceAudioScript(text, voiceId) {
    try {
      if (!this.ollamaApiKey) return null;
      const voice = this.voices.find(v => v.id === voiceId) || this.voices[0];
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are a professional script writer for text-to-speech. Enhance scripts to sound natural and engaging.' },
            { role: 'user', content: `Enhance this script for a ${voice.gender} voice with ${voice.accent} accent:\n\n${text}` }
          ],
          options: { temperature: 0.6, num_predict: 800 }
        })
      });
      if (!response.ok) return null;
      const data = await response.json();
      return { script: data.message.content };
    } catch (error) {
      console.log('Script enhancement failed:', error.message);
      return null;
    }
  }

  async recognize(audioFile, options = {}) {
    // Placeholder – integrate with a real STT API like Whisper if you add a key
    const { language = 'en' } = options;
    console.log(`🎤 Recognizing speech from: ${audioFile} (simulated)`);
    await this.simulateDelay(2000);
    const transcription = this.generateTranscription();
    return { success: true, text: transcription.text, confidence: transcription.confidence };
  }

  generateTranscription() {
    const transcriptions = [
      { text: "Hello, this is a test of the speech recognition system.", confidence: 0.95 },
      { text: "I'd like to learn more about artificial intelligence in Africa.", confidence: 0.92 }
    ];
    return transcriptions[Math.floor(Math.random() * transcriptions.length)];
  }

  async cloneVoice(audioSamples, name) {
    console.log(`🎭 Cloning voice: ${name} (simulated)`);
    await this.simulateDelay(4000);
    const newVoice = { id: `custom-${name}-${Date.now()}`, name, language: 'en', gender: 'custom' };
    this.voices.push(newVoice);
    return { success: true, voice: newVoice };
  }

  async generatePodcast(topic, options = {}) {
    if (!this.ollamaApiKey) return this.getMockPodcastScript(topic, options.duration);
    try {
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.ollamaApiKey}` },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are a podcast script writer.' },
            { role: 'user', content: `Create a ${options.duration || 300}-second podcast script about: ${topic}` }
          ],
          options: { temperature: 0.7, num_predict: 2000 }
        })
      });
      if (!response.ok) return this.getMockPodcastScript(topic, options.duration);
      const data = await response.json();
      return { success: true, topic, script: data.message.content, provider: 'ollama' };
    } catch (error) {
      return this.getMockPodcastScript(topic, options.duration);
    }
  }

  getMockPodcastScript(topic, duration = 300) {
    return { success: true, topic, script: `[Mock podcast about ${topic}]`, provider: 'mock' };
  }

  async createAudioBook(text, options = {}) {
    // Placeholder
    const bookId = this.generateRequestId();
    return { success: true, id: bookId, title: options.title || 'Audio Book' };
  }

  splitIntoChapters(text, maxLength = 2000) {
    const words = text.split(/\s+/);
    const chapters = [];
    let current = [];
    for (const word of words) {
      current.push(word);
      if (current.join(' ').length > maxLength) {
        chapters.push(current.join(' '));
        current = [];
      }
    }
    if (current.length) chapters.push(current.join(' '));
    return chapters;
  }

  listVoices() { return this.voices.concat(this.elevenLabsVoices); }

  estimateDuration(text, speed = 1.0) {
    const wordsPerSecond = 3 * speed;
    return parseFloat((text.split(/\s+/).length / wordsPerSecond).toFixed(1));
  }

  getAudioUrl(id, format) {
    return `/generated-audio/${id}.${format}`;
  }

  async saveMetadata(audioData) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');
    try {
      let metadata = [];
      try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')); } catch {}
      metadata.push({ id: audioData.id, text: audioData.text.substring(0, 100), voice: audioData.voice.id, duration: audioData.duration, timestamp: audioData.timestamp });
      if (metadata.length > 100) metadata = metadata.slice(-100);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) { console.error('Failed to save metadata:', error); }
  }

  async listAudio(limit = 20) {
    try {
      const data = await fs.readFile(path.join(this.outputDir, 'metadata.json'), 'utf8');
      return JSON.parse(data).slice(-limit).reverse();
    } catch { return this.generated.slice(-limit).reverse(); }
  }

  getStats() {
    return {
      generatedCount: this.generated.length,
      voicesCount: this.voices.length + this.elevenLabsVoices.length,
      lastGenerated: this.generated[this.generated.length - 1]?.timestamp,
      apiKeyConfigured: !!this.ollamaApiKey
    };
  }

  generateRequestId() { return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }
  simulateDelay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = new AudioEngine();
