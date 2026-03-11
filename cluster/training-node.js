/**
 * Distributed Training Node
 * Handles model training across the cluster
 */
const { exec } = require("child_process");
const util = require("util");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const EventEmitter = require('events');

const execPromise = util.promisify(exec);

class TrainingNode extends EventEmitter {
  constructor(id = null) {
    super();
    
    this.id = id || `trainer-${Date.now()}`;
    this.status = 'idle';
    this.currentJob = null;
    this.trainingHistory = [];
    
    this.metrics = {
      jobsCompleted: 0,
      totalTrainingTime: 0,
      datasetsProcessed: 0,
      modelsTrained: []
    };

    this.gpuAvailable = this.checkGpuAvailability();
    this.trainingDir = path.join(os.tmpdir(), 'cephasgm-training');
    
    this.initialize();
  }

  /**
   * Initialize training node
   */
  async initialize() {
    console.log(`🎓 Initializing training node: ${this.id}`);
    
    try {
      await fs.mkdir(this.trainingDir, { recursive: true });
      console.log(`📁 Training directory created: ${this.trainingDir}`);
    } catch (error) {
      console.error('Failed to create training directory:', error);
    }

    this.status = 'ready';
    
    console.log(`✅ Training node ${this.id} ready - GPU: ${this.gpuAvailable ? '✓' : '✗'}`);
  }

  /**
   * Check GPU availability
   */
  checkGpuAvailability() {
    try {
      // Try to detect NVIDIA GPU
      const result = require('child_process').spawnSync('nvidia-smi', { stdio: 'ignore' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  /**
   * Train a model on a dataset
   */
  async train(dataset, options = {}) {
    const {
      model = 'llama3',
      epochs = 3,
      batchSize = 32,
      learningRate = 0.001,
      validationSplit = 0.2,
      modelName = `model-${Date.now()}`
    } = options;

    const jobId = this.generateJobId();
    const startTime = Date.now();

    console.log(`\n🎓 [${jobId}] Starting training on ${this.id}`);
    console.log(`📊 Dataset: ${dataset}`);
    console.log(`⚙️ Model: ${model}, Epochs: ${epochs}, Batch Size: ${batchSize}`);

    if (this.status !== 'idle') {
      return {
        success: false,
        error: 'Training node is busy',
        currentJob: this.currentJob
      };
    }

    this.status = 'training';
    this.currentJob = {
      id: jobId,
      dataset,
      model,
      epochs,
      batchSize,
      learningRate,
      startTime
    };

    try {
      // Prepare dataset
      const preparedData = await this.prepareDataset(dataset);
      
      // Simulate training progress
      const results = await this.runTraining(preparedData, {
        model,
        epochs,
        batchSize,
        learningRate,
        validationSplit
      });

      // Save trained model
      const modelPath = await this.saveModel(modelName, results);

      const endTime = Date.now();
      const trainingTime = endTime - startTime;

      // Update metrics
      this.metrics.jobsCompleted++;
      this.metrics.totalTrainingTime += trainingTime;
      this.metrics.datasetsProcessed++;
      this.metrics.modelsTrained.push({
        name: modelName,
        model,
        dataset,
        time: trainingTime,
        completedAt: new Date().toISOString()
      });

      const result = {
        success: true,
        jobId,
        modelName,
        modelPath,
        trainingTime,
        epochs: epochs,
        finalLoss: results.finalLoss,
        accuracy: results.accuracy,
        validationAccuracy: results.validationAccuracy,
        metrics: results.metrics,
        timestamp: new Date().toISOString()
      };

      // Store in history
      this.trainingHistory.push({
        ...result,
        dataset,
        model
      });

      this.emit('trainingComplete', result);

      return result;

    } catch (error) {
      console.error(`❌ [${jobId}] Training failed:`, error);

      this.emit('trainingFailed', {
        jobId,
        error: error.message
      });

      return {
        success: false,
        jobId,
        error: error.message
      };

    } finally {
      this.status = 'idle';
      this.currentJob = null;
    }
  }

  /**
   * Prepare dataset for training
   */
  async prepareDataset(dataset) {
    console.log(`📦 Preparing dataset: ${dataset}`);

    // Simulate dataset preparation
    await this.sleep(2000);

    // If dataset is a path, read it
    if (typeof dataset === 'string' && dataset.startsWith('/')) {
      try {
        const data = await fs.readFile(dataset, 'utf8');
        const lines = data.split('\n').filter(line => line.trim());
        
        return {
          name: path.basename(dataset),
          size: lines.length,
          samples: lines.slice(0, 100), // First 100 samples for demo
          format: 'text'
        };
      } catch {
        // Fall back to simulated data
      }
    }

    // Simulated dataset
    return {
      name: 'simulated-dataset',
      size: 10000,
      samples: Array(10).fill().map((_, i) => ({
        id: i,
        text: `Sample ${i} for training`,
        label: i % 2
      })),
      format: 'simulated'
    };
  }

  /**
   * Run training process
   */
  async runTraining(dataset, config) {
    const { epochs, batchSize, learningRate, validationSplit } = config;

    console.log('⚙️ Starting training...');

    let loss = 1.0;
    let accuracy = 0.0;

    // Simulate training epochs
    for (let epoch = 1; epoch <= epochs; epoch++) {
      // Simulate training step
      await this.sleep(1000);

      // Improve metrics
      loss = Math.max(0.1, loss * 0.7);
      accuracy = Math.min(0.95, accuracy + 0.2 + Math.random() * 0.1);

      console.log(`Epoch ${epoch}/${epochs} - loss: ${loss.toFixed(4)} - accuracy: ${accuracy.toFixed(4)}`);

      this.emit('trainingProgress', {
        epoch,
        totalEpochs: epochs,
        loss,
        accuracy
      });
    }

    // Simulate validation
    const validationAccuracy = accuracy * (0.9 + Math.random() * 0.1);

    return {
      finalLoss: loss,
      accuracy: accuracy,
      validationAccuracy: validationAccuracy,
      metrics: {
        precision: accuracy * 0.95,
        recall: accuracy * 0.92,
        f1Score: accuracy * 0.93
      },
      history: Array(epochs).fill().map((_, i) => ({
        epoch: i + 1,
        loss: 1.0 * Math.pow(0.7, i),
        accuracy: Math.min(0.95, 0.3 + i * 0.2)
      }))
    };
  }

  /**
   * Save trained model
   */
  async saveModel(modelName, results) {
    const modelDir = path.join(this.trainingDir, modelName);
    await fs.mkdir(modelDir, { recursive: true });

    // Save model metadata
    const metadata = {
      name: modelName,
      created: new Date().toISOString(),
      metrics: results.metrics,
      finalLoss: results.finalLoss,
      accuracy: results.accuracy
    };

    await fs.writeFile(
      path.join(modelDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2)
    );

    // Save model weights (simulated)
    await fs.writeFile(
      path.join(modelDir, 'model.weights'),
      `Simulated model weights for ${modelName}`
    );

    console.log(`💾 Model saved to: ${modelDir}`);

    return modelDir;
  }

  /**
   * Fine-tune an existing model
   */
  async finetune(baseModel, dataset, options = {}) {
    console.log(`🔄 Fine-tuning ${baseModel} on new dataset`);

    const result = await this.train(dataset, {
      ...options,
      model: baseModel,
      modelName: `${baseModel}-ft-${Date.now()}`
    });

    return result;
  }

  /**
   * Get training status
   */
  getStatus() {
    return {
      id: this.id,
      status: this.status,
      currentJob: this.currentJob,
      metrics: this.metrics,
      gpuAvailable: this.gpuAvailable,
      historyCount: this.trainingHistory.length
    };
  }

  /**
   * Get training history
   */
  getHistory(limit = 10) {
    return this.trainingHistory.slice(-limit).reverse();
  }

  /**
   * Cancel current training job
   */
  cancelTraining() {
    if (this.status === 'training') {
      this.status = 'cancelled';
      console.log(`🛑 Training cancelled on ${this.id}`);
      
      this.emit('trainingCancelled', {
        jobId: this.currentJob?.id,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        jobId: this.currentJob?.id,
        status: 'cancelled'
      };
    }

    return {
      success: false,
      error: 'No training job in progress'
    };
  }

  /**
   * Generate job ID
   */
  generateJobId() {
    return `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create default training node
const defaultTrainer = new TrainingNode('trainer-1');

module.exports = defaultTrainer;
module.exports.TrainingNode = TrainingNode;
