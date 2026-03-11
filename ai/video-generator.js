const fetch = require("node-fetch")

exports.create = async(prompt)=>{

const response = await fetch("https://api.runwayml.com/v1/video",{

method:"POST",

headers:{
"Authorization":"Bearer "+process.env.RUNWAY_KEY,
"Content-Type":"application/json"
},

body:JSON.stringify({

prompt:prompt

})

})

const data = await response.json()

return data.url

}
