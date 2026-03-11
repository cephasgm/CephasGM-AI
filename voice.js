// Check if browser supports speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

if (!SpeechRecognition) {
  console.error("Speech recognition not supported")
}

const recognition = SpeechRecognition ? new SpeechRecognition() : null

if (recognition) {
  recognition.continuous = false
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.maxAlternatives = 1

  recognition.onresult = function(event){
    const transcript = event.results[0][0].transcript
    const promptInput = document.getElementById("prompt")
    if (promptInput) {
      promptInput.value = transcript
    }
  }

  recognition.onerror = function(event) {
    console.error("Speech recognition error:", event.error)
    alert("Voice recognition error: " + event.error)
  }
}

function startVoice(){
  if (recognition) {
    recognition.start()
  } else {
    alert("Voice recognition not supported in this browser")
  }
}

window.startVoice = startVoice
