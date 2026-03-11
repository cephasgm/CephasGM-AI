const fs = require("fs")

exports.run = async(task)=>{

fs.appendFileSync("automation-log.txt",task+"\n")

return "Task logged for automation"

}
