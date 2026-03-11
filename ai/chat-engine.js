const fetch = require("node-fetch")

exports.chat = async(prompt)=>{

const response = await fetch("https://api.openai.com/v1/chat/completions",{

method:"POST",

headers:{
"Content-Type":"application/json",
"Authorization":"Bearer "+process.env.OPENAI_KEY
},

body:JSON.stringify({

model:"gpt-4o-mini",

messages:[
{role:"user",content:prompt}
]

})

})

const data = await response.json()

return data.choices[0].message.content

}
