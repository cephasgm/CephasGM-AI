const functions = require("firebase-functions")
const fetch = require("node-fetch")

exports.image = functions.https.onRequest(async(req,res)=>{

// Enable CORS
res.set('Access-Control-Allow-Origin', '*')
res.set('Access-Control-Allow-Methods', 'POST')
res.set('Access-Control-Allow-Headers', 'Content-Type')

if (req.method === 'OPTIONS') {
  res.status(204).send('')
  return
}

try {
  const prompt = req.body.prompt

  if (!prompt) {
    res.status(400).json({error: "Prompt is required"})
    return
  }

  const response = await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer " + (process.env.OPENAI_KEY || "sk-demo-key")
    },
    body:JSON.stringify({
      model:"dall-e-2",
      prompt:prompt,
      n:1,
      size:"512x512"
    })
  })

  const data = await response.json()
  
  res.json({
    url: data.data ? data.data[0].url : "https://via.placeholder.com/512?text=Image+Generation"
  })

} catch(error) {
  console.error("Image generation error:", error)
  res.status(500).json({error: error.message})
}

})
