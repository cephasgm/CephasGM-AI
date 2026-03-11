async function generateImage(){

const prompt = document.getElementById("imagePrompt").value

const response = await fetch("/api/image",{

method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({prompt})

})

const data = await response.json()

document.getElementById("imageResult").src = data.url

}
