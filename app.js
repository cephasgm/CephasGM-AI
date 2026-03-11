const chatBox = document.getElementById("chat")
const input = document.getElementById("prompt")

async function sendMessage(){

const prompt = input.value
if (!prompt.trim()) return

addMessage("You",prompt)

input.value=""

try {
  const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/chat",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({prompt})
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const data = await response.json()
  addMessage("CephasAI", data.reply || "No response from AI")

} catch(error) {
  console.error("Chat error:", error)
  addMessage("CephasAI", "Sorry, I'm having trouble connecting. Please try again.")
}

}

function addMessage(user,text){

const div = document.createElement("div")

div.innerHTML = "<b>"+user+":</b> "+text

chatBox.appendChild(div)

}

// Make function globally available
window.sendMessage = sendMessage
