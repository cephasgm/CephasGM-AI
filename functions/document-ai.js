const functions = require("firebase-functions")
const pdfParse = require("pdf-parse")
const Busboy = require("busboy")

exports.documentAI = functions.https.onRequest(async(req,res)=>{

// Enable CORS
res.set('Access-Control-Allow-Origin', '*')
res.set('Access-Control-Allow-Methods', 'POST')
res.set('Access-Control-Allow-Headers', 'Content-Type')

if (req.method === 'OPTIONS') {
  res.status(204).send('')
  return
}

// Only allow POST requests
if (req.method !== 'POST') {
  res.status(405).json({error: "Method not allowed"})
  return
}

try {
  // Parse multipart form data
  const busboy = Busboy({ headers: req.headers })
  let fileBuffer = null
  let fileName = ""
  
  busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
    fileName = filename
    const chunks = []
    file.on('data', (data) => chunks.push(data))
    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks)
    })
  })

  busboy.on('finish', async () => {
    if (!fileBuffer) {
      res.status(400).json({error: "No file uploaded"})
      return
    }

    try {
      // Parse PDF
      const pdfData = await pdfParse(fileBuffer)
      
      // Get first 1000 characters as summary
      const summary = pdfData.text.substring(0, 1000) + (pdfData.text.length > 1000 ? "..." : "")
      
      res.json({
        fileName: fileName,
        pageCount: pdfData.numpages,
        info: pdfData.info,
        metadata: pdfData.metadata,
        summary: summary,
        fullLength: pdfData.text.length,
        message: "Document processed successfully"
      })

    } catch(parseError) {
      console.error("PDF parse error:", parseError)
      res.status(400).json({error: "Invalid or corrupted PDF file"})
    }
  })

  req.pipe(busboy)

} catch(error) {
  console.error("Document AI error:", error)
  res.status(500).json({error: error.message})
}

})
