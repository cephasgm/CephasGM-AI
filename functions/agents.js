const functions = require("firebase-functions")
const fetch = require("node-fetch")

// Simple agent executor
async function executeTask(task) {
  
  // Task routing logic
  if (task.includes("search") || task.includes("find")) {
    return { result: `Searching for: ${task}`, action: "search" }
    
  } else if (task.includes("summarize") || task.includes("summary")) {
    return { result: `Summarizing: ${task}`, action: "summarize" }
    
  } else if (task.includes("translate")) {
    return { result: `Translating: ${task}`, action: "translate" }
    
  } else if (task.includes("image") || task.includes("picture")) {
    return { result: `Generating image for: ${task}`, action: "image" }
    
  } else {
    // Default to chat
    return { result: `Processing: ${task}`, action: "chat" }
  }
}

exports.agent = functions.https.onRequest(async(req,res)=>{

// Enable CORS
res.set('Access-Control-Allow-Origin', '*')
res.set('Access-Control-Allow-Methods', 'POST')
res.set('Access-Control-Allow-Headers', 'Content-Type')

if (req.method === 'OPTIONS') {
  res.status(204).send('')
  return
}

try {
  const task = req.body.task

  if (!task) {
    res.status(400).json({error: "Task is required"})
    return
  }

  const result = await executeTask(task)
  
  res.json({
    task: task,
    result: result.result,
    action: result.action,
    status: "completed"
  })

} catch(error) {
  console.error("Agent error:", error)
  res.status(500).json({error: error.message})
}

})
