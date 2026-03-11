/**
 * Vector Memory - Store and retrieve conversation memories
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAukJQx3pEqXoyFR9tyfeLckJaBIgYtGFA",
  authDomain: "cephasgm-ai.firebaseapp.com",
  projectId: "cephasgm-ai",
  storageBucket: "cephasgm-ai.firebasestorage.app",
  messagingSenderId: "304163647028",
  appId: "1:304163647028:web:2920b2cfb9be4049806461"
};

// Initialize Firebase
let app, db;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log("Firebase initialized for memory");
} catch (error) {
  console.error("Firebase initialization error:", error);
}

/**
 * Save conversation to memory
 */
export async function saveMemory(prompt, response, metadata = {}) {
  if (!db) {
    console.error("Firestore not initialized");
    return { error: "Database not available" };
  }

  try {
    const memoryRef = collection(db, "memory");
    
    const docRef = await addDoc(memoryRef, {
      prompt: prompt,
      response: response,
      metadata: metadata,
      timestamp: Date.now(),
      userId: metadata.userId || "anonymous",
      sessionId: metadata.sessionId || getSessionId()
    });
    
    console.log("Memory saved with ID:", docRef.id);
    
    // Also save to vector memory API for similarity search
    saveToVectorMemory(prompt, response, docRef.id);
    
    return { success: true, id: docRef.id };
    
  } catch(error) {
    console.error("Error saving memory:", error);
    return { error: error.message };
  }
}

/**
 * Save to vector memory API
 */
async function saveToVectorMemory(prompt, response, id) {
  try {
    const vectorResponse = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "add",
        text: prompt + " " + response,
        id: id,
        metadata: {
          prompt: prompt,
          response: response,
          type: "conversation"
        }
      })
    });
    
    if (!vectorResponse.ok) {
      console.warn("Vector memory API warning:", await vectorResponse.text());
    }
    
  } catch (error) {
    console.warn("Vector memory API unavailable:", error);
  }
}

/**
 * Search similar memories
 */
export async function searchMemories(query, limit = 5) {
  try {
    const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "search",
        text: query,
        limit: limit,
        threshold: 0.3
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.results || [];
    
  } catch (error) {
    console.error("Memory search error:", error);
    return [];
  }
}

/**
 * Get recent memories
 */
export async function getRecentMemories(count = 10) {
  if (!db) {
    console.error("Firestore not initialized");
    return [];
  }

  try {
    const memoryRef = collection(db, "memory");
    const q = query(memoryRef, orderBy("timestamp", "desc"), limit(count));
    const querySnapshot = await getDocs(q);
    
    const memories = [];
    querySnapshot.forEach((doc) => {
      memories.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return memories;
    
  } catch (error) {
    console.error("Error getting memories:", error);
    return [];
  }
}

/**
 * Get or create session ID
 */
function getSessionId() {
  let sessionId = localStorage.getItem("cephasgm_session");
  
  if (!sessionId) {
    sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("cephasgm_session", sessionId);
  }
  
  return sessionId;
}

/**
 * Clear memory (local only)
 */
export function clearLocalMemory() {
  if (confirm("Clear all local memory?")) {
    localStorage.removeItem("chatHistory");
    localStorage.removeItem("cephasgm_session");
    alert("Local memory cleared");
  }
}

// Make available globally
window.saveMemory = saveMemory;
window.searchMemories = searchMemories;
window.getRecentMemories = getRecentMemories;
window.clearLocalMemory = clearLocalMemory;
