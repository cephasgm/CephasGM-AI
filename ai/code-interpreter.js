const vm = require("vm")

exports.run = async(code)=>{

try{

const result = vm.runInNewContext(code)

return result

}

catch(err){

return err.toString()

}

}
