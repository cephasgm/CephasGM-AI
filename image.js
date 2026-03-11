async function generateImage(){

const prompt = document.getElementById("imagePrompt").value

if (!prompt) {
  alert("Please enter an image description")
  return
}

try {
  const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/image",{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({prompt})
  })

  const data = await response.json()
  
  const imgElement = document.getElementById("imageResult")
  if (imgElement) {
    imgElement.src = data.url
    imgElement.style.display = "block"
  }

} catch(error) {
  alert("Image generation failed: " + error.message)
}

}

window.generateImage = generateImage
