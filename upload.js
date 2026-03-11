async function uploadFile(){

const file = document.getElementById("file").files[0]

const formData = new FormData()

formData.append("file",file)

await fetch("/api/upload",{

method:"POST",
body:formData

})

alert("File uploaded")

}
