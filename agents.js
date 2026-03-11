export async function runAgent(task){

try {
  const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/agent",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({task})
  })

  return await response.json()
  
} catch(error) {
  console.error("Agent error:", error)
  return { error: error.message }
}

}

window.runAgent = runAgent
