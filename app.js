const chatBox = document.getElementById("chat")
const input = document.getElementById("prompt")

async function sendMessage(){

const prompt = input.value

addMessage("You",prompt)

input.value=""

const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/chat",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({prompt})
})

const data = await response.json()

addMessage("CephasAI",data.reply)

}

function addMessage(user,text){

const div = document.createElement("div")

div.innerHTML = "<b>"+user+":</b> "+text

chatBox.appendChild(div)

}

// Make function globally available
window.sendMessage = sendMessage
