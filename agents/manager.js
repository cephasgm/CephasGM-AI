const research = require("./research-agent")
const coding = require("./coding-agent")

exports.route = async(task)=>{

if(task.includes("research"))
return research.run(task)

if(task.includes("code"))
return coding.run(task)

return "Agent not found"

}
