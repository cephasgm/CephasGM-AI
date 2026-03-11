import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAukJQx3pEqXoyFR9tyfeLckJaBIgYtGFA",
  authDomain: "cephasgm-ai.firebaseapp.com",
  projectId: "cephasgm-ai",
  storageBucket: "cephasgm-ai.firebasestorage.app",
  messagingSenderId: "304163647028",
  appId: "1:304163647028:web:2920b2cfb9be4049806461"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

export async function saveMemory(prompt,response){
  try {
    await addDoc(collection(db,"memory"),{
      prompt,
      response,
      timestamp:Date.now()
    })
    console.log("Memory saved successfully")
  } catch(error) {
    console.error("Error saving memory:", error)
  }
}

// Also make available globally
window.saveMemory = saveMemory
