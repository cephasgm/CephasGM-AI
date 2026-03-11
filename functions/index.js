const chat = require("./ai-chat")
const image = require("./image-gen")
const documentAI = require("./document-ai")
const agents = require("./agents")

exports.chat = chat.chat
exports.image = image.image
exports.documentAI = documentAI.documentAI
exports.agent = agents.agent
