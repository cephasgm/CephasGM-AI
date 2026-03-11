const functions = require("firebase-functions")
const fetch = require("node-fetch")

exports.image = functions.https.onRequest(async(req,res)=>{

const prompt = req.body.prompt

const response = await fetch("https://api.openai.com/v1/images/generations",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer "+process.env.OPENAI_KEY
},

body:JSON.stringify({

model:"gpt-image-1",
prompt:prompt

})

})

const data = await response.json()

res.json({

url:data.data[0].url

})

})
