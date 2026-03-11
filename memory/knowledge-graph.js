const graph = {}

exports.addRelation = (entity,relation,target)=>{

if(!graph[entity])
graph[entity]=[]

graph[entity].push({relation,target})

}

exports.getRelations = (entity)=>{

return graph[entity] || []

}
