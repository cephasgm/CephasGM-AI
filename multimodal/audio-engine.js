/**
 * Multimodal Audio Engine - Speech synthesis, recognition, and AI audio processing
 * Now integrates ElevenLabs for high-quality TTS, with Ollama for script enhancement.
 */
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

class AudioEngine extends EventEmitter {
  constructor() {
    super();
    
    // Custom voices (used for display and fallback)
    this.voices = [
      { id: 'african-female-1', name: 'Amara', language: 'en', gender: 'female', accent: 'west-african' },
      { id: 'african-male-1', name: 'Kwame', language: 'en', gender: 'male', accent: 'west-african' },
      { id: 'african-female-2', name: 'Zuri', language: 'en', gender: 'female', accent: 'east-african' },
      { id: 'african-male-2', name: 'Jabari', language: 'en', gender: 'male', accent: 'east-african' },
      { id: 'standard-female', name: 'Emma', language: 'en', gender: 'female', accent: 'american' },
      { id: 'standard-male', name: 'James', language: 'en', gender: 'male', accent: 'british' }
    ];

    // Mapping to ElevenLabs voice IDs (user can override via environment)
    // Default to ElevenLabs example voices – replace with actual IDs if known
    this.elevenLabsVoiceMap = {
      'african-female-1': process.env.ELEVENLABS_VOICE_AFRICAN_FEMALE || '21m00Tcm4TlvDq8ikWAM', // Rachel
      'african-male-1': process.env.ELEVENLABS_VOICE_AFRICAN_MALE || 'TxGEqnHWrfWFTfGW9XjX', // Josh
      'african-female-2': process.env.ELEVENLABS_VOICE_AFRICAN_FEMALE_2 || '21m00Tcm4TlvDq8ikWAM',
      'african-male-2': process.env.ELEVENLABS_VOICE_AFRICAN_MALE_2 || 'TxGEqnHWrfWFTfGW9XjX',
      'standard-female': process.env.ELEVENLABS_VOICE_STANDARD_FEMALE || '21m00Tcm4TlvDq8ikWAM',
      'standard-male': process.env.ELEVENLABS_VOICE_STANDARD_MALE || 'TxGEqnHWrfWFTfGW9XjX'
    };
    
    this.generated = [];
    this.outputDir = path.join(__dirname, '../generated-audio');
    this.ollamaApiKey = process.env.OLLAMA_API_KEY;
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    
    this.initOutputDir();
    
    console.log('🔊 Audio engine initialized');
    console.log(`   Ollama: ${this.ollamaApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   ElevenLabs: ${this.elevenLabsApiKey ? '✅ Configured' : '❌ Missing'}`);
    console.log(`   Voices available: ${this.voices.length}`);
  }

  /**
   * Initialize output directory
   */
  async initOutputDir() {
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create audio directory:', error);
    }
  }

  /**
   * Generate audio from text (TTS) with AI enhancement
   */
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
      let scriptMetadata = null;
      
      if (enhanceScript && this.ollamaApiKey) {
        const enhanced = await this.enhanceAudioScript(text, voice);
        if (enhanced) {
          finalText = enhanced.script;
          scriptMetadata = enhanced.metadata;
        }
      }

      // Get voice details
      const voiceConfig = this.voices.find(v => v.id === voice) || this.voices[0];

      // Attempt real TTS with ElevenLabs if key exists
      let audioUrl;
      let usedProvider = 'simulated';
      if (this.elevenLabsApiKey) {
        try {
          audioUrl = await this.callElevenLabs(finalText, voice, options);
          usedProvider = 'elevenlabs';
        } catch (error) {
          console.warn(`ElevenLabs TTS failed: ${error.message}. Falling back to simulation.`);
        }
      }

      // If ElevenLabs didn't work, simulate
      if (!audioUrl) {
        const audioDuration = this.estimateDuration(finalText, speed);
        await this.simulateDelay(Math.min(500 + finalText.length * 5, 3000));
        audioUrl = this.getAudioUrl(requestId, format);
      }

      const audioData = {
        id: requestId,
        text: finalText,
        originalText: text,
        voice: voiceConfig,
        speed,
        pitch,
        format,
        duration: this.estimateDuration(finalText, speed),
        url: audioUrl,
        provider: usedProvider,
        enhanced: !!scriptMetadata,
        scriptMetadata,
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

      return {
        success: false,
        requestId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Call ElevenLabs TTS API
   */
  async callElevenLabs(text, voiceId, options = {}) {
    const elevenLabsVoiceId = this.elevenLabsVoiceMap[voiceId] || voiceId; // fallback to using the ID directly
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${elevenLabsVoiceId}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.elevenLabsApiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
          speed: options.speed || 1.0
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
    }

    // The response is an audio stream (MP3). We could save it to a file and return a URL.
    // For simplicity, we'll return a data URL or a placeholder. In production, you'd upload to cloud storage.
    // Here we'll return a data URL for demo purposes.
    const buffer = await response.buffer();
    const base64 = buffer.toString('base64');
    return `data:audio/mpeg;base64,${base64}`;
  }

  /**
   * Enhance audio script using Ollama
   */
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
            { 
              role: 'system', 
              content: 'You are a professional script writer for text-to-speech. Enhance scripts to sound natural and engaging when spoken. Consider pacing, emotion, and vocal delivery.'
            },
            { 
              role: 'user', 
              content: `Enhance this script for a ${voice.gender} voice with ${voice.accent} accent. Make it sound natural when spoken:\n\n${text}`
            }
          ],
          options: {
            temperature: 0.6,
            num_predict: 800
          }
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      
      return {
        script: data.message.content,
        metadata: {
          enhanced: true,
          model: 'llama3.2',
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.log('Script enhancement failed:', error.message);
      return null;
    }
  }

  /**
   * Speech-to-text (recognition) with AI analysis
   */
  async recognize(audioFile, options = {}) {
    const {
      language = 'en',
      model = 'base',
      analyze = false
    } = options;

    console.log(`🎤 Recognizing speech from: ${audioFile}`);

    // Simulate recognition
    await this.simulateDelay(2000);

    // Generate transcription based on input
    const transcription = this.generateTranscription(audioFile);
    
    let analysis = null;
    
    // Analyze with AI if requested
    if (analyze && this.ollamaApiKey && transcription.text) {
      analysis = await this.analyzeTranscription(transcription.text);
    }

    return {
      success: true,
      text: transcription.text,
      confidence: transcription.confidence,
      language,
      model,
      duration: transcription.duration,
      words: transcription.words,
      analysis: analysis,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate realistic transcription for demo
   */
  generateTranscription(audioFile) {
    const transcriptions = [
      {
        text: "Hello, I'm testing the speech recognition system. It seems to be working well.",
        confidence: 0.95,
        duration: 3.2,
        words: 12
      },
      {
        text: "I'd like to learn more about artificial intelligence and how it can be applied in Africa.",
        confidence: 0.92,
        duration: 4.5,
        words: 18
      },
      {
        text: "Can you help me with my research project on sustainable technology?",
        confidence: 0.88,
        duration: 3.8,
        words: 14
      },
      {
        text: "What are the latest developments in voice synthesis for African languages?",
        confidence: 0.90,
        duration: 4.1,
        words: 16
      }
    ];
    
    return transcriptions[Math.floor(Math.random() * transcriptions.length)];
  }

  /**
   * Analyze transcription with AI
   */
  async analyzeTranscription(text) {
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
              content: 'Analyze speech transcriptions for sentiment, intent, and key topics. Provide structured analysis.'
            },
            { 
              role: 'user', 
              content: `Analyze this transcription: "${text}"\n\nProvide sentiment, intent, key topics, and suggested responses.`
            }
          ],
          options: {
            temperature: 0.4,
            num_predict: 500
          }
        })
      });

      if (!response.ok) return null;

      const data = await response.json();
      
      return {
        analysis: data.message.content,
        provider: 'ollama-cloud',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.log('Transcription analysis failed:', error.message);
      return null;
    }
  }

  /**
   * Clone voice using AI (simulated)
   */
  async cloneVoice(audioSamples, name, options = {}) {
    console.log(`🎭 Cloning voice: ${name} (${audioSamples.length} samples)`);

    await this.simulateDelay(4000);

    const newVoice = {
      id: `custom-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: name,
      language: options.language || 'en',
      gender: options.gender || 'female',
      accent: options.accent || 'custom',
      samples: audioSamples.length,
      createdAt: new Date().toISOString()
    };

    this.voices.push(newVoice);

    return {
      success: true,
      voice: newVoice,
      message: `Voice "${name}" cloned successfully. You can now use it for TTS.`,
      usage: 'Use voice ID: ' + newVoice.id
    };
  }

  /**
   * Generate podcast script with AI
   */
  async generatePodcast(topic, options = {}) {
    const {
      duration = 300, // 5 minutes
      hosts = 2,
      style = 'conversational'
    } = options;

    if (!this.ollamaApiKey) {
      return this.getMockPodcastScript(topic, duration);
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
              content: `You are a podcast script writer. Create engaging ${style} podcast scripts with ${hosts} hosts. Include timing cues and natural conversation flow.`
            },
            { 
              role: 'user', 
              content: `Create a ${duration}-second podcast script about: ${topic}. Include intro, main discussion, and outro.`
            }
          ],
          options: {
            temperature: 0.7,
            num_predict: 2000
          }
        })
      });

      if (!response.ok) {
        return this.getMockPodcastScript(topic, duration);
      }

      const data = await response.json();
      
      return {
        success: true,
        topic,
        duration,
        hosts,
        style,
        script: data.message.content,
        provider: 'ollama-cloud',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Podcast generation failed:', error);
      return this.getMockPodcastScript(topic, duration);
    }
  }

  /**
   * Get mock podcast script
   */
  getMockPodcastScript(topic, duration) {
    return {
      success: true,
      topic,
      duration,
      script: `[PODCAST SCRIPT: ${topic}]

INTRO (0:00-0:30)
Host 1: Welcome to CephasGM AI Podcast! Today we're discussing ${topic}.
Host 2: This is a fascinating topic that's relevant to African innovation.

MAIN DISCUSSION (0:30-${duration-30})
Host 1: Let's explore the key aspects of ${topic}...
Host 2: I think the most important thing to consider is...

OUTRO (${duration-30}-${duration})
Host 1: Thanks for listening to our discussion about ${topic}.
Host 2: Join us next time for more insights on AI and technology in Africa.`,
      provider: 'mock',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create audio book with chapters
   */
  async createAudioBook(text, options = {}) {
    const {
      title = 'Generated Audio Book',
      chapters = [],
      voice = 'african-female-1'
    } = options;

    const bookId = this.generateRequestId();
    const chapters_list = [];

    // Split text into chapters if not provided
    if (chapters.length === 0) {
      const textChunks = this.splitIntoChapters(text);
      for (let i = 0; i < textChunks.length; i++) {
        chapters_list.push({
          number: i + 1,
          title: `Chapter ${i + 1}`,
          text: textChunks[i]
        });
      }
    } else {
      chapters_list.push(...chapters);
    }

    // Generate metadata
    const book = {
      id: bookId,
      title,
      chapters: chapters_list.map(ch => ({
        ...ch,
        duration: this.estimateDuration(ch.text),
        url: this.getAudioUrl(`${bookId}_ch${ch.number}`, 'mp3')
      })),
      totalChapters: chapters_list.length,
      totalDuration: chapters_list.reduce((acc, ch) => acc + this.estimateDuration(ch.text), 0),
      voice,
      createdAt: new Date().toISOString()
    };

    return {
      success: true,
      ...book,
      message: `Audio book created with ${book.totalChapters} chapters`
    };
  }

  /**
   * Split text into roughly equal chapters
   */
  splitIntoChapters(text, maxChapterLength = 2000) {
    const words = text.split(/\s+/);
    const chapters = [];
    let currentChapter = [];

    for (const word of words) {
      currentChapter.push(word);
      if (currentChapter.join(' ').length > maxChapterLength) {
        chapters.push(currentChapter.join(' '));
        currentChapter = [];
      }
    }

    if (currentChapter.length > 0) {
      chapters.push(currentChapter.join(' '));
    }

    return chapters;
  }

  /**
   * List available voices
   */
  listVoices() {
    return this.voices;
  }

  /**
   * Get voice by ID
   */
  getVoice(voiceId) {
    return this.voices.find(v => v.id === voiceId);
  }

  /**
   * Estimate audio duration from text
   */
  estimateDuration(text, speed = 1.0) {
    const wordsPerSecond = 3 * speed; // Average speaking rate
    const wordCount = text.split(/\s+/).length;
    return parseFloat((wordCount / wordsPerSecond).toFixed(1));
  }

  /**
   * Get audio URL (placeholder)
   */
  getAudioUrl(id, format) {
    return `https://storage.cephasgm.ai/audio/${id}.${format}`;
  }

  /**
   * Save metadata
   */
  async saveMetadata(audioData) {
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
        id: audioData.id,
        text: audioData.text.substring(0, 100) + '...',
        voice: audioData.voice.id,
        duration: audioData.duration,
        timestamp: audioData.timestamp
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
   * List generated audio
   */
  async listAudio(limit = 20) {
    const metadataPath = path.join(this.outputDir, 'metadata.json');

    try {
      const data = await fs.readFile(metadataPath, 'utf8');
      const audio = JSON.parse(data);
      return audio.slice(-limit).reverse();
    } catch {
      return this.generated.slice(-limit).reverse().map(a => ({
        id: a.id,
        text: a.text.substring(0, 100) + '...',
        voice: a.voice.id,
        duration: a.duration,
        timestamp: a.timestamp
      }));
    }
  }

  /**
   * Get engine stats
   */
  getStats() {
    return {
      generatedCount: this.generated.length,
      voicesCount: this.voices.length,
      lastGenerated: this.generated[this.generated.length - 1]?.timestamp,
      apiKeyConfigured: {
        ollama: !!this.ollamaApiKey,
        elevenlabs: !!this.elevenLabsApiKey
      }
    };
  }

  /**
   * Generate request ID
   */
  generateRequestId() {
    return `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Simulate delay
   */
  simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AudioEngine();
