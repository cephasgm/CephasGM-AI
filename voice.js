const recognition = new webkitSpeechRecognition()

recognition.onresult = function(event){

const transcript = event.results[0][0].transcript

document.getElementById("prompt").value = transcript

}

function startVoice(){

recognition.start()

}
