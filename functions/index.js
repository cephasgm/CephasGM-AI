const functions = require("firebase-functions")
const aiChat = require("./ai-chat")
const imageGen = require("./image-gen")
const documentAI = require("./document-ai")
const vectorMemory = require("./vector-memory")
const agents = require("./agents")

// Export all functions
exports.chat = aiChat.chat
exports.image = imageGen.image
exports.documentAI = documentAI.documentAI
exports.vectorMemory = vectorMemory
exports.agent = agents.agent
