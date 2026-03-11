export async function runAgent(task){

const response = await fetch("/api/agent",{

method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({task})

})

return await response.json()

}
