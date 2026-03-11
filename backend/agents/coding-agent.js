// coding-agent.js
const Agent = require("../core/agent-runtime") || class Agent {
  constructor(name){ this.name = name }
  canHandle(task){ return false }
  async execute(task){ return "Not implemented" }
};
const vm = require("vm");

class CodingAgent extends Agent {
  constructor(){
    super("coding");
  }

  canHandle(task){
    return task.toLowerCase().includes("run code");
  }

  async execute(task){
    try {
      const code = task.replace(/run code/i,"");
      const result = vm.runInNewContext(code);
      return result;
    } catch(err){
      return err.toString();
    }
  }
}

module.exports = new CodingAgent();
