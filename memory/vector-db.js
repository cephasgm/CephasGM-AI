const { Pinecone } = require("@pinecone-database/pinecone")

const client = new Pinecone({
apiKey:process.env.PINECONE_KEY
})

exports.store = async(vector)=>{

const index = client.Index("cephasgm")

await index.upsert([vector])

}
