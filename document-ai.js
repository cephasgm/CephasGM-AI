const functions = require("firebase-functions")
const pdfParse = require("pdf-parse")

exports.documentAI = functions.https.onRequest(async(req,res)=>{

const text = await pdfParse(req.file)

res.json({
summary:text.text.substring(0,1000)
})

})
