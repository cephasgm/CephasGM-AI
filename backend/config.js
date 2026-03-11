// config.js
// Store all environment variables and API keys here

module.exports = {
  openaiApiKey: process.env.OPENAI_KEY || "YOUR_OPENAI_API_KEY",
  runwayApiKey: process.env.RUNWAY_KEY || "YOUR_RUNWAY_API_KEY",
  pineconeKey: process.env.PINECONE_KEY || "YOUR_PINECONE_KEY",
  gpuNodeCommand: process.env.GPU_NODE_CMD || "ollama run llama3"
}
