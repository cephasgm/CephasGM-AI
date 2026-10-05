/**
 * CephasGM SI - functions/index.js
 * ----------------------------------------------------------------------------
 * Entry point. Firebase loads this file and reads every exported function.
 *
 * Defensive loading:
 *   Each function module is loaded with safeRequire(). If a module file is
 *   missing or has a syntax error, that one function is skipped - the rest
 *   still deploy. This prevents a single broken file from taking down the
 *   whole deploy with an X on every function.
 *
 * ASCII only. No em dashes, no checkmarks, no curly quotes.
 * ----------------------------------------------------------------------------
 */

'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Firebase-functions logger falls back to console if unavailable.
let logger;
try {
  logger = require('firebase-functions/logger');
} catch (e) {
  logger = console;
}

/* ==========================================================================
 * Safe module loader
 * ------------------------------------------------------------------------
 * Returns the module if it loads. Returns null on failure (missing file,
 * syntax error, etc.) so the deploy can continue.
 * ======================================================================== */
function safeRequire(path, label) {
  try {
    const mod = require(path);
    logger.log('[index] loaded ' + label);
    return mod;
  } catch (e) {
    logger.warn('[index] skipped ' + label + ' - ' + e.message);
    return null;
  }
}

/* ==========================================================================
 * Load function modules
 * ------------------------------------------------------------------------
 * Add a module here only after the .js file exists in this folder.
 * Missing modules are skipped cleanly.
 * ======================================================================== */
const aiChat       = safeRequire('./ai-chat',       'ai-chat');
const imageGen     = safeRequire('./image-gen',     'image-gen');
const documentAI   = safeRequire('./document-ai',   'document-ai');
const vectorMemory = safeRequire('./vector-memory', 'vector-memory');
const agents       = safeRequire('./agents',        'agents');

/* ==========================================================================
 * AUTH TRIGGER - set default role on new user
 * ======================================================================== */
exports.setDefaultRole = functions.auth.user().onCreate(async (user) => {
  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'user' });
    await admin.firestore().collection('users').doc(user.uid).set({
      email: user.email || null,
      role: 'user',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    logger.log('[setDefaultRole] assigned default role to ' + (user.email || user.uid));
    return null;
  } catch (error) {
    logger.error('[setDefaultRole] failed', error);
    return null;
  }
});

/* ==========================================================================
 * ADMIN CALLABLE - update user role
 * ======================================================================== */
exports.updateUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to update roles.'
    );
  }

  let callerClaims = {};
  try {
    const caller = await admin.auth().getUser(context.auth.uid);
    callerClaims = caller.customClaims || {};
  } catch (e) {
    throw new functions.https.HttpsError('internal', 'Could not load caller record.');
  }

  if (callerClaims.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can update roles.'
    );
  }

  const uid = data && data.uid;
  const role = data && data.role;
  if (!uid || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing uid or role.');
  }

  const allowedRoles = ['user', 'premium', 'admin'];
  if (allowedRoles.indexOf(role) === -1) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Role must be one of: ' + allowedRoles.join(', ')
    );
  }

  try {
    await admin.auth().setCustomUserClaims(uid, { role: role });
    await admin.firestore().collection('users').doc(uid).set({
      role: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { success: true, message: 'Role updated to ' + role };
  } catch (error) {
    logger.error('[updateUserRole] failed', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/* ==========================================================================
 * CALLABLE - get current user's role
 * ======================================================================== */
exports.getUserRole = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Not logged in.');
  }
  try {
    const user = await admin.auth().getUser(context.auth.uid);
    const claims = user.customClaims || {};
    return { role: claims.role || 'user' };
  } catch (e) {
    throw new functions.https.HttpsError('internal', 'Could not load user record.');
  }
});

/* ==========================================================================
 * HTTP functions - exported conditionally
 * ------------------------------------------------------------------------
 * Only export a function if its module loaded AND it declares the expected
 * export. Otherwise Firebase would try to deploy a broken function.
 * ======================================================================== */
if (aiChat && aiChat.chat) {
  exports.chat = aiChat.chat;
}

if (imageGen && imageGen.image) {
  exports.image = imageGen.image;
}

if (documentAI && documentAI.documentAI) {
  exports.documentAI = documentAI.documentAI;
}

if (vectorMemory && vectorMemory.vectorMemory) {
  exports.vectorMemory = vectorMemory.vectorMemory;
}

if (agents && agents.agent) {
  exports.agent = agents.agent;
}

/* ==========================================================================
 * Health check - always available
 * ======================================================================== */
exports.health = functions.https.onRequest(function (req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  const loaded = {
    chat: !!aiChat,
    image: !!imageGen,
    documentAI: !!documentAI,
    vectorMemory: !!vectorMemory,
    agent: !!agents
  };
  res.json({
    status: 'healthy',
    service: 'CephasGM SI Functions',
    version: '6.0.0-si',
    timestamp: Date.now(),
    modules: loaded
  });
});
