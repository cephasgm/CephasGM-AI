const express = require("express")
const bodyParser = require("body-parser")

const chatEngine = require("./ai/chat-engine")
const researchAgent = require("./agents/research-agent")
const codeInterpreter = require("./ai/code-interpreter")
const videoGenerator = require("./ai/video-generator")

const app = express()

app.use(bodyParser.json())

app.post("/chat", async(req,res)=>{

const reply = await chatEngine.chat(req.body.prompt)

res.json({reply})

})

app.post("/research", async(req,res)=>{

const result = await researchAgent.run(req.body.topic)

res.json({result})

})

app.post("/code", async(req,res)=>{

const output = await codeInterpreter.run(req.body.code)

res.json({output})

})

app.post("/video", async(req,res)=>{

const url = await videoGenerator.create(req.body.prompt)

res.json({url})

})

app.listen(3000,()=>{

console.log("CephasGM AI server running")

})
