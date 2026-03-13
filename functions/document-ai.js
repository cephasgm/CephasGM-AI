const functions = require("firebase-functions");
const pdfParse = require("pdf-parse");
const Busboy = require("busboy");
const fetch = require('node-fetch');

const openaiApiKey = process.env.OPENAI_API_KEY;
const ollamaApiKey = process.env.OLLAMA_API_KEY;

/**
 * Document AI - Analyze PDFs and documents
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/documentAI
 */
exports.documentAI = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST with multipart/form-data." });
    return;
  }

  // Check content type
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    return;
  }

  try {
    // Parse multipart form data
    const busboy = Busboy({ headers: req.headers });
    
    let fileBuffer = null;
    let fileName = "";
    let fileMimeType = "";
    let fields = {};

    // Handle file upload
    busboy.on('file', (fieldname, file, { filename, encoding, mimeType }) => {
      fileName = filename;
      fileMimeType = mimeType;
      
      const chunks = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    // Handle form fields
    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    // Process when done
    busboy.on('finish', async () => {
      if (!fileBuffer) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      try {
        let result = {};

        // Process based on file type
        if (fileMimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
          // Parse PDF
          const pdfData = await pdfParse(fileBuffer);
          
          result = {
            type: "pdf",
            fileName: fileName,
            pageCount: pdfData.numpages,
            info: pdfData.info,
            metadata: pdfData.metadata,
            text: pdfData.text.substring(0, 5000) + (pdfData.text.length > 5000 ? "..." : ""),
            wordCount: pdfData.text.split(/\s+/).length,
            characterCount: pdfData.text.length
          };
        } else if (fileMimeType.startsWith('text/') || fileName.endsWith('.txt')) {
          // Text file
          const text = fileBuffer.toString('utf-8');
          result = {
            type: "text",
            fileName: fileName,
            text: text.substring(0, 5000) + (text.length > 5000 ? "..." : ""),
            wordCount: text.split(/\s+/).length,
            characterCount: text.length,
            lineCount: text.split('\n').length
          };
        } else {
          // Unsupported file type
          result = {
            type: "unsupported",
            fileName: fileName,
            mimeType: fileMimeType,
            size: fileBuffer.length,
            message: "File type not supported for detailed analysis. Supported: PDF, TXT"
          };
        }

        // Generate AI summary if text is available and summary requested
        let summary = "";
        if (fields.summary !== "false" && result.text && result.text.length > 100) {
          summary = await generateSummary(result.text, result.type);
        }

        res.json({
          success: true,
          ...result,
          summary: summary || "No summary generated",
          analysis: fields.analysis || "basic",
          timestamp: Date.now()
        });

      } catch (parseError) {
        console.error("Document parse error:", parseError);
        res.status(400).json({ 
          error: "Failed to parse document", 
          details: parseError.message 
        });
      }
    });

    req.pipe(busboy);

  } catch (error) {
    console.error("Document AI error:", error);
    res.status(500).json({ 
      error: "Document processing failed", 
      details: error.message 
    });
  }
});

/**
 * Generate summary using OpenAI or Ollama
 */
async function generateSummary(text, docType) {
  const prompt = `Summarize the following ${docType} document in 3-5 sentences, highlighting the main points:\n\n${text}`;

  // Prefer OpenAI
  if (openaiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that summarizes documents.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.5,
          max_tokens: 200
        })
      });
      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message.content;
      }
    } catch (e) {
      console.warn('OpenAI summary failed, falling back to Ollama', e);
    }
  }

  // Fallback to Ollama
  if (ollamaApiKey) {
    try {
      const response = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ollamaApiKey}`
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that summarizes documents.' },
            { role: 'user', content: prompt }
          ],
          options: {
            temperature: 0.5,
            num_predict: 200
          }
        })
      });
      if (response.ok) {
        const data = await response.json();
        return data.message.content;
      }
    } catch (e) {
      console.warn('Ollama summary failed', e);
    }
  }

  // Last resort: simple truncation
  return text.substring(0, 300) + "...";
}
