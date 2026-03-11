const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

// Import function modules
const aiChat = require("./ai-chat");
const imageGen = require("./image-gen");
const documentAI = require("./document-ai");
const vectorMemory = require("./vector-memory");
const agents = require("./agents");

// Export all functions
exports.chat = aiChat.chat;
exports.image = imageGen.image;
exports.documentAI = documentAI.documentAI;
exports.vectorMemory = vectorMemory.vectorMemory;
exports.agent = agents.agent;

// Health check endpoint
exports.health = functions.https.onRequest((req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json({
    status: "healthy",
    service: "CephasGM AI Backend",
    version: "2.0.0",
    timestamp: Date.now(),
    functions: ["chat", "image", "documentAI", "vectorMemory", "agent"]
  });
});
