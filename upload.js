async function uploadFile(){

const file = document.getElementById("file").files[0]

if (!file) {
  alert("Please select a file")
  return
}

const formData = new FormData()

formData.append("file",file)

try {
  const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/upload",{
    method:"POST",
    body:formData
  })
  
  const result = await response.json()
  alert("File uploaded: " + (result.message || "Success"))

} catch(error) {
  alert("Upload failed: " + error.message)
}

}

window.uploadFile = uploadFile
