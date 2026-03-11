const fetch = require("node-fetch")

exports.run = async(topic)=>{

const wiki = await fetch(

"https://en.wikipedia.org/api/rest_v1/page/summary/"+encodeURIComponent(topic)

)

const data = await wiki.json()

return data.extract

}
