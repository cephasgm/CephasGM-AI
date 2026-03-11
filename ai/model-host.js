const { spawn } = require("child_process")

exports.startModel = ()=>{

const process = spawn("ollama",["run","llama3"])

process.stdout.on("data",(data)=>{

console.log(data.toString())

})

}
