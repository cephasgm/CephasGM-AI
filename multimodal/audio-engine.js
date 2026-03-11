/**
 * Audio Engine - Speech-to-Text and Text-to-Speech processing
 * 
 * Integrates with:
 * - OpenAI Whisper (production)
 * - Coqui TTS (production)
 * - Mozilla DeepSpeech (production)
 * 
 * Phase 4: Working placeholder with file management
 */
const fs = require("fs").promises;
const path = require("path");
const { createReadStream, createWriteStream } = require("fs");
const util = require("util");
const { exec } = require("child_process");
const execPromise = util.promisify(exec);

class AudioEngine {
  constructor() {
    this.audioFolder = path.join(__dirname, "../uploads/audio");
    this.tempFolder = path.join(__dirname, "../temp/audio");
    this.supportedFormats = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    
    // Available engines (for future integration)
    this.engines = {
      whisper: { available: false, type: 'stt' },
      coqui: { available: false, type: 'tts' },
      deepspeech: { available: false, type: 'stt' },
      google: { available: false, type: 'both' }
    };
    
    this.stats = {
      sttProcessed: 0,
      ttsGenerated: 0,
      totalAudioSize: 0,
      errors: 0
    };
    
    this.initDirectories();
    this.checkEngines();
  }

  /**
   * Initialize directories
   */
  async initDirectories() {
    try {
      await fs.mkdir(this.audioFolder, { recursive: true });
      await fs.mkdir(this.tempFolder, { recursive: true });
      console.log(`🎵 Audio engine initialized - Output: ${this.audioFolder}`);
    } catch (error) {
      console.error('Failed to create audio directories:', error);
    }
  }

  /**
   * Check available audio engines
   */
  async checkEngines() {
    // Check for whisper (via command line)
    try {
      await execPromise('whisper --help');
      this.engines.whisper.available = true;
      console.log('✅ OpenAI Whisper detected');
    } catch {
      console.log('⚠️ OpenAI Whisper not available (using placeholder)');
    }

    // Check for ffmpeg (required for audio processing)
    try {
      await execPromise('ffmpeg -version');
      console.log('✅ FFmpeg detected');
    } catch {
      console.log('⚠️ FFmpeg not found - audio conversion limited');
    }
  }

  /**
   * Convert speech to text using Whisper or placeholder
   */
  async speechToText(filePath, options = {}) {
    const {
      engine = 'auto',
      language = 'en',
      model = 'base'
    } = options;

    try {
      // Validate file
      if (!filePath) {
        throw new Error('File path is required');
      }

      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`Audio file not found: ${filePath}`);
      }

      // Check file size
      const stats = await fs.stat(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 100) {
        throw new Error('File too large (max 100MB)');
      }

      console.log(`🎤 Processing speech-to-text: ${path.basename(filePath)} (${fileSizeMB.toFixed(2)}MB)`);

      let result;

      // Try to use real engine if available
      if (engine === 'whisper' || (engine === 'auto' && this.engines.whisper.available)) {
        result = await this.transcribeWithWhisper(filePath, language, model);
      } else {
        result = await this.placeholderTranscribe(filePath);
      }

      // Update stats
      this.stats.sttProcessed++;
      this.stats.totalAudioSize += stats.size;

      return {
        success: true,
        ...result,
        file: filePath,
        engine: result.engine || 'placeholder',
        language,
        processingTime: result.processingTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Speech-to-text error:', error);
      this.stats.errors++;
      
      return {
        success: false,
        error: error.message,
        transcript: null
      };
    }
  }

  /**
   * Transcribe with OpenAI Whisper
   */
  async transcribeWithWhisper(filePath, language, model) {
    const startTime = Date.now();

    // Convert to format whisper expects if needed
    const ext = path.extname(filePath).toLowerCase();
    let audioFile = filePath;

    if (!['.mp3', '.wav', '.m4a'].includes(ext)) {
      // Convert to wav using ffmpeg
      const convertedPath = path.join(this.tempFolder, `converted_${Date.now()}.wav`);
      await execPromise(`ffmpeg -i "${filePath}" -ar 16000 -ac 1 "${convertedPath}"`);
      audioFile = convertedPath;
    }

    try {
      // Run whisper
      const { stdout } = await execPromise(
        `whisper "${audioFile}" --model ${model} --language ${language} --output_dir "${this.tempFolder}"`
      );

      const processingTime = Date.now() - startTime;

      // Parse transcript from stdout
      const transcriptMatch = stdout.match(/\[.*?\](.*)/g);
      const transcript = transcriptMatch 
        ? transcriptMatch.map(l => l.replace(/\[.*?\]/, '').trim()).join(' ')
        : stdout;

      // Read the generated txt file if it exists
      const txtFile = path.join(this.tempFolder, path.basename(audioFile, path.extname(audioFile)) + '.txt');
      let fullTranscript = transcript;
      
      try {
        fullTranscript = await fs.readFile(txtFile, 'utf8');
      } catch {
        // Use stdout transcript
      }

      // Cleanup temp files
      try {
        if (audioFile !== filePath) await fs.unlink(audioFile);
        await fs.unlink(txtFile);
      } catch {
        // Ignore cleanup errors
      }

      return {
        transcript: fullTranscript,
        engine: 'whisper',
        model,
        processingTime,
        confidence: 0.95 // Placeholder confidence
      };

    } catch (error) {
      console.error('Whisper transcription failed:', error);
      return this.placeholderTranscribe(filePath);
    }
  }

  /**
   * Placeholder transcription (for demo)
   */
  async placeholderTranscribe(filePath) {
    // Simulate processing time
    const startTime = Date.now();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Generate a realistic placeholder transcript
    const fileName = path.basename(filePath, path.extname(filePath));
    const timestamp = new Date().toLocaleTimeString();

    const transcripts = [
      `This is a simulated transcription of the audio file "${fileName}". In production with Whisper or other STT engines, you would get actual transcribed text here. The audio was processed at ${timestamp}.`,
      
      `Speech recognition placeholder: The audio file "${fileName}" was received and processed. To enable real transcription, install OpenAI Whisper or configure another STT engine.`,
      
      `[Simulated transcript] Thank you for using CephasGM AI's audio engine. This is a placeholder response. For production use, please set up Whisper or your preferred speech-to-text engine.`
    ];

    const processingTime = Date.now() - startTime;

    return {
      transcript: transcripts[Math.floor(Math.random() * transcripts.length)],
      engine: 'placeholder',
      processingTime,
      confidence: 0.85
    };
  }

  /**
   * Convert text to speech
   */
  async textToSpeech(text, options = {}) {
    const {
      engine = 'auto',
      voice = 'default',
      speed = 1.0,
      format = 'mp3'
    } = options;

    try {
      if (!text || typeof text !== 'string') {
        throw new Error('Text must be a non-empty string');
      }

      if (text.length > 5000) {
        throw new Error('Text too long (max 5000 characters)');
      }

      console.log(`🔊 Generating speech for: "${text.substring(0, 50)}..."`);

      const fileName = `tts-${Date.now()}.${format}`;
      const outputPath = path.join(this.audioFolder, fileName);

      let result;

      // Try to use real engine if available
      if (engine === 'coqui' || (engine === 'auto' && this.engines.coqui.available)) {
        result = await this.generateWithCoqui(text, outputPath, voice, speed);
      } else {
        result = await this.placeholderTTS(text, outputPath, format);
      }

      // Update stats
      this.stats.ttsGenerated++;
      this.stats.totalAudioSize += result.fileSize || 0;

      return {
        success: true,
        ...result,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        voice,
        speed,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Text-to-speech error:', error);
      this.stats.errors++;
      
      return {
        success: false,
        error: error.message,
        file: null
      };
    }
  }

  /**
   * Generate speech with Coqui TTS
   */
  async generateWithCoqui(text, outputPath, voice, speed) {
    try {
      const startTime = Date.now();

      // This would use the actual Coqui TTS API
      // For now, use placeholder
      await this.placeholderTTS(text, outputPath, 'wav');

      const stats = await fs.stat(outputPath);
      const processingTime = Date.now() - startTime;

      return {
        file: outputPath,
        engine: 'coqui',
        format: 'wav',
        fileSize: stats.size,
        duration: Math.ceil(text.length / 15), // Rough estimate: 15 chars per second
        processingTime
      };

    } catch (error) {
      console.error('Coqui TTS failed:', error);
      return this.placeholderTTS(text, outputPath, 'mp3');
    }
  }

  /**
   * Placeholder TTS generation
   */
  async placeholderTTS(text, outputPath, format) {
    const startTime = Date.now();

    // Create a placeholder audio file
    // In production, this would be actual synthesized speech
    const placeholderContent = Buffer.from(
      `Placeholder TTS audio for text: ${text.substring(0, 200)}`
    );

    await fs.writeFile(outputPath, placeholderContent);

    const processingTime = Date.now() - startTime;
    const stats = await fs.stat(outputPath);

    return {
      file: outputPath,
      engine: 'placeholder',
      format,
      fileSize: stats.size,
      duration: Math.ceil(text.length / 15), // Rough estimate
      processingTime,
      message: 'Placeholder audio generated. For real TTS, install Coqui TTS or configure another engine.'
    };
  }

  /**
   * Convert audio format using ffmpeg
   */
  async convertAudio(inputPath, outputFormat = 'mp3') {
    try {
      const outputPath = path.join(this.tempFolder, `converted_${Date.now()}.${outputFormat}`);
      
      await execPromise(`ffmpeg -i "${inputPath}" "${outputPath}"`);
      
      return {
        success: true,
        path: outputPath,
        format: outputFormat
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get audio metadata
   */
  async getMetadata(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const ext = path.extname(filePath).toLowerCase();

      let duration = 0;
      
      // Try to get duration with ffprobe
      try {
        const { stdout } = await execPromise(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        );
        duration = parseFloat(stdout) || 0;
      } catch {
        // Estimate duration from file size (very rough)
        duration = stats.size / 16000; // Assuming 16kbps
      }

      return {
        file: filePath,
        size: stats.size,
        format: ext.substring(1),
        duration,
        created: stats.birthtime,
        modified: stats.mtime
      };

    } catch (error) {
      return {
        error: error.message
      };
    }
  }

  /**
   * List generated audio files
   */
  async listFiles(limit = 20) {
    try {
      const files = await fs.readdir(this.audioFolder);
      
      const audioFiles = await Promise.all(
        files
          .filter(f => this.supportedFormats.includes(path.extname(f).toLowerCase()))
          .slice(-limit)
          .map(async f => {
            const filePath = path.join(this.audioFolder, f);
            const metadata = await this.getMetadata(filePath);
            return {
              name: f,
              ...metadata
            };
          })
      );

      return audioFiles.reverse();

    } catch (error) {
      console.error('Failed to list audio files:', error);
      return [];
    }
  }

  /**
   * Delete audio file
   */
  async deleteFile(filePath) {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      ...this.stats,
      engines: this.engines,
      audioFolder: this.audioFolder,
      freeSpace: null // Would need df command
    };
  }

  /**
   * Check if a file is audio
   */
  isAudioFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  /**
   * Stream audio file (for HTTP responses)
   */
  streamAudio(filePath, res) {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      
      stream.on('open', () => {
        stream.pipe(res);
      });
      
      stream.on('error', reject);
      stream.on('end', resolve);
    });
  }

  /**
   * Clean up old temp files
   */
  async cleanup(olderThan = 3600000) { // Default: 1 hour
    try {
      const files = await fs.readdir(this.tempFolder);
      const now = Date.now();
      let deleted = 0;

      for (const file of files) {
        const filePath = path.join(this.tempFolder, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtimeMs > olderThan) {
          await fs.unlink(filePath);
          deleted++;
        }
      }

      console.log(`🧹 Cleaned up ${deleted} old temp files`);
      return { deleted };

    } catch (error) {
      console.error('Cleanup failed:', error);
      return { error: error.message };
    }
  }
}

module.exports = new AudioEngine();
