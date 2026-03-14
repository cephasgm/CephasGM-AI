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

// ============================================
// AUTH TRIGGER: Set default role on new user
// ============================================
exports.setDefaultRole = functions.auth.user().onCreate(async (user) => {
  try {
    // Set custom claim for new user
    await admin.auth().setCustomUserClaims(user.uid, { role: 'user' });
    console.log(`✅ Set default role 'user' for ${user.email}`);
    
    // Store user in Firestore
    await admin.firestore().collection('users').doc(user.uid).set({
      email: user.email,
      role: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return null;
  } catch (error) {
    console.error('Error setting default role:', error);
    return null;
  }
});

// ============================================
// ADMIN FUNCTION: Update user role
// ============================================
exports.updateUserRole = functions.https.onCall(async (data, context) => {
  // Ensure the caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to update roles.'
    );
  }

  // Check if the caller has admin role
  const callerClaims = (await admin.auth().getUser(context.auth.uid)).customClaims || {};
  if (callerClaims.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can update roles.'
    );
  }

  const { uid, role } = data;
  if (!uid || !role) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing uid or role.'
    );
  }

  // Validate role
  const allowedRoles = ['user', 'premium', 'admin'];
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Role must be one of: ${allowedRoles.join(', ')}`
    );
  }

  try {
    // Set the new role
    await admin.auth().setCustomUserClaims(uid, { role });
    
    // Update Firestore record
    await admin.firestore().collection('users').doc(uid).update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, message: `Role updated to ${role}` };
  } catch (error) {
    console.error('Error updating role:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ============================================
// FUNCTION: Get current user's role (for frontend)
// ============================================
exports.getUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Not logged in');
  }
  const user = await admin.auth().getUser(context.auth.uid);
  const claims = user.customClaims || {};
  return { role: claims.role || 'user' };
});

// Export existing functions
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
    functions: ["chat", "image", "documentAI", "vectorMemory", "agent", "setDefaultRole", "updateUserRole", "getUserRole"]
  });
});
