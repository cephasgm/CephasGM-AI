/**
 * Backend Routes - Additional endpoints for frontend compatibility
 */

module.exports = (app, modelHost, vectorDb) => {
    
    // ============================================
    // Image Generation Endpoint (main)
    // ============================================
    const handleImageGen = async (req, res) => {
        try {
            const { prompt } = req.body;
            if (!prompt) {
                return res.status(400).json({ error: 'Prompt is required' });
            }

            // Load the image engine (path corrected)
            let imageEngine;
            try {
                imageEngine = require('../multimodal/image-engine');
            } catch (err) {
                console.error('Failed to load image-engine:', err.message);
                throw new Error('Image engine not available');
            }

            // Generate the image – enable prompt enhancement
            const result = await imageEngine.generate(prompt, {
                enhancePrompt: true,  // use Ollama or chat engine to refine prompt
                model: 'dall-e-2',    // can be changed via options
                size: '512x512'
            });

            res.json(result);
        } catch (error) {
            console.error('Image generation error:', error);
            // Fallback to a simple placeholder
            res.json({
                url: `https://via.placeholder.com/512x512?text=${encodeURIComponent(prompt.substring(0, 30))}`,
                simulated: true,
                error: error.message
            });
        }
    };

    // Main route (without /api)
    app.post('/generate/image', handleImageGen);

    // Additional route to match frontend's first attempt
    app.post('/api/generate/image', handleImageGen);
    
    // ============================================
    // Upload Endpoint
    // ============================================
    app.post('/upload', async (req, res) => {
        try {
            // This would normally use multer or busboy
            // For now, return success message
            res.json({
                success: true,
                message: 'Upload endpoint ready',
                fileName: req.body.filename || 'unknown',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // ============================================
    // Audio Generation Endpoint
    // ============================================
    app.post('/generate/audio', async (req, res) => {
        try {
            const { text, options } = req.body;
            
            if (!text) {
                return res.status(400).json({ error: 'Text is required' });
            }
            
            // Try to use audio engine if available
            let result;
            try {
                const audioEngine = require('./multimodal/audio-engine');
                result = await audioEngine.generate(text, options);
            } catch (e) {
                // Simulated response
                result = {
                    url: `https://storage.cephasgm.ai/audio/simulated.mp3`,
                    duration: text.length / 15,
                    simulated: true
                };
            }
            
            res.json(result);
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // ============================================
    // Memory Vectors Endpoint (GET)
    // ============================================
    app.get('/memory/vectors', async (req, res) => {
        try {
            // Get stats from vector DB
            const stats = vectorDb.getStats ? vectorDb.getStats() : { totalVectors: 0 };
            
            // Get recent vectors if available
            let vectors = [];
            try {
                // This depends on your vector DB implementation
                vectors = vectorDb.getRecent ? await vectorDb.getRecent(20) : [];
            } catch (e) {
                // No vectors available
            }
            
            res.json({
                success: true,
                vectors,
                stats,
                message: 'Vector memory endpoint'
            });
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // ============================================
    // Task Routing for Agents
    // ============================================
    app.post('/task', async (req, res) => {
        try {
            const { task, options = {} } = req.body;
            
            if (!task) {
                return res.status(400).json({ error: 'Task is required' });
            }
            
            const agentType = options.agentType || 'auto';
            
            // Route to appropriate agent
            let result;
            const startTime = Date.now();
            
            try {
                const agentManager = require('../agents/manager');
                
                if (agentType === 'search' || task.toLowerCase().includes('search')) {
                    const researchAgent = require('../agents/research-agent');
                    result = await researchAgent.execute(task);
                } else if (agentType === 'coding' || task.toLowerCase().includes('code')) {
                    const codeInterpreter = require('./ai/code-interpreter');
                    result = await codeInterpreter.run(task);
                } else if (agentType === 'translate') {
                    const textEngine = require('./multimodal/text-engine');
                    result = await textEngine.translate(task.replace('translate', '').trim(), 'english');
                } else {
                    // Default to agent manager
                    result = await agentManager.route(task, options);
                }
            } catch (e) {
                // Fallback response
                result = {
                    success: true,
                    message: `Task processed: ${task}`,
                    note: 'Using fallback response',
                    timestamp: new Date().toISOString()
                };
            }
            
            const executionTime = Date.now() - startTime;
            
            res.json({
                success: true,
                agent: agentType,
                task,
                result,
                executionTime: `${executionTime}ms`,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // ============================================
    // Code Execution Endpoint
    // ============================================
    app.post('/code', async (req, res) => {
        try {
            const { code, language = 'javascript', options = {} } = req.body;
            
            if (!code) {
                return res.status(400).json({ error: 'Code is required' });
            }
            
            const startTime = Date.now();
            
            let result;
            try {
                const codeInterpreter = require('./ai/code-interpreter');
                result = await codeInterpreter.run(code, { language, ...options });
            } catch (e) {
                // Simulated response
                result = {
                    output: `Code execution simulated for ${language}`,
                    executionTime: '100ms'
                };
            }
            
            res.json({
                success: true,
                output: result.output,
                error: result.error,
                executionTime: `${Date.now() - startTime}ms`,
                language
            });
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // ============================================
    // CORS Headers for Firebase Functions
    // ============================================
    app.options('*', (req, res) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.sendStatus(200);
    });
};
