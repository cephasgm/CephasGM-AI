const functions = require("firebase-functions")
const fetch = require("node-fetch")

exports.chat = functions.https.onRequest(async(req,res)=>{

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

  const response = await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer " + (process.env.OPENAI_KEY || "sk-demo-key")
    },
    body:JSON.stringify({
      model:"gpt-3.5-turbo",
      messages:[
        {role:"system", content:"You are CephasGM AI, an African-inspired AI assistant."},
        {role:"user", content:prompt}
      ]
    })
  })

  const data = await response.json()
  
  res.json({
    reply: data.choices ? data.choices[0].message.content : "AI response unavailable"
  })

} catch(error) {
  console.error("Chat error:", error)
  res.status(500).json({error: error.message})
}

})
