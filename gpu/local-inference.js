const { exec } = require("child_process")

exports.run = (prompt)=>{

return new Promise((resolve)=>{

exec(`ollama run llama3 "${prompt}"`,(err,stdout)=>{

resolve(stdout)

})

})

}
