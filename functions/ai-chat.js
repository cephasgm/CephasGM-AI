const functions = require("firebase-functions")
const fetch = require("node-fetch")

exports.chat = functions.https.onRequest(async(req,res)=>{

const prompt = req.body.prompt

const response = await fetch("https://api.openai.com/v1/chat/completions",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer "+process.env.OPENAI_KEY
},

body:JSON.stringify({

model:"gpt-4o-mini",

messages:[
{role:"user",content:prompt}
]

})

})

const data = await response.json()

res.json({

reply:data.choices[0].message.content

})

})
