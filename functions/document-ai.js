const functions = require("firebase-functions")
const pdfParse = require("pdf-parse")

exports.documentAI = functions.https.onRequest(async(req,res)=>{

// Enable CORS
res.set('Access-Control-Allow-Origin', '*')
res.set('Access-Control-Allow-Methods', 'POST')
res.set('Access-Control-Allow-Headers', 'Content-Type')

if (req.method === 'OPTIONS') {
  res.status(204).send('')
  return
}

try {
  // In a real implementation, you'd receive the file via multipart/form-data
  // For this demo, we'll accept text directly
  const text = req.body.text || "Sample document text"
  
  res.json({
    summary: text.substring(0,500),
    message: "Document processed successfully"
  })

} catch(error) {
  console.error("Document AI error:", error)
  res.status(500).json({error: error.message})
}

})
