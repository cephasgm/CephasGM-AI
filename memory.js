/**
 * Vector Memory - Store and retrieve conversation memories
 * Fixed - Works without modules
 */

// Initialize Firebase (only once)
window.MemoryModule = window.MemoryModule || (function() {
    const firebaseConfig = window.CEPHASGM_CONFIG?.FIREBASE || {
        apiKey: "AIzaSyAukJQx3pEqXoyFR9tyfeLckJaBIgYtGFA",
        authDomain: "cephasgm-ai.firebaseapp.com",
        projectId: "cephasgm-ai",
        storageBucket: "cephasgm-ai.firebasestorage.app",
        messagingSenderId: "304163647028",
        appId: "1:304163647028:web:2920b2cfb9be4049806461"
    };
    
    let app, db;
    
    // Load Firebase dynamically
    function loadFirebase() {
        return new Promise((resolve, reject) => {
            if (window.firebase) {
                resolve(window.firebase);
                return;
            }
            
            const script = document.createElement('script');
            script.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
            script.onload = () => {
                const firestoreScript = document.createElement('script');
                firestoreScript.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
                firestoreScript.onload = resolve;
                firestoreScript.onerror = reject;
                document.head.appendChild(firestoreScript);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    async function initialize() {
        try {
            await loadFirebase();
            
            if (!window.firebase.apps.length) {
                app = window.firebase.initializeApp(firebaseConfig);
                db = window.firebase.firestore();
                console.log("Firebase initialized for memory");
            } else {
                app = window.firebase.app();
                db = window.firebase.firestore();
            }
            return true;
        } catch (error) {
            console.error("Firebase initialization error:", error);
            return false;
        }
    }
    
    async function saveMemory(prompt, response, metadata = {}) {
        if (!db) {
            const initialized = await initialize();
            if (!initialized) {
                console.error("Firestore not initialized");
                return { error: "Database not available" };
            }
        }
        
        try {
            const docRef = await db.collection("memory").add({
                prompt: prompt,
                response: response,
                metadata: metadata,
                timestamp: Date.now(),
                userId: metadata.userId || "anonymous",
                sessionId: metadata.sessionId || getSessionId()
            });
            
            console.log("Memory saved with ID:", docRef.id);
            
            // Try vector memory, but don't wait for it
            saveToVectorMemory(prompt, response, docRef.id).catch(() => {});
            
            return { success: true, id: docRef.id };
            
        } catch(error) {
            console.error("Error saving memory:", error);
            return { error: error.message };
        }
    }
    
    async function saveToVectorMemory(prompt, response, id) {
        try {
            await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
        } catch (error) {
            console.warn("Vector memory API unavailable:", error);
        }
    }
    
    async function searchMemories(query, limit = 5) {
        try {
            const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/vectorMemory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "search",
                    text: query,
                    limit: limit,
                    threshold: 0.3
                })
            });
            
            if (!response.ok) return [];
            
            const data = await response.json();
            return data.results || [];
            
        } catch (error) {
            console.error("Memory search error:", error);
            return [];
        }
    }
    
    async function getRecentMemories(count = 10) {
        if (!db) {
            const initialized = await initialize();
            if (!initialized) return [];
        }
        
        try {
            const snapshot = await db.collection("memory")
                .orderBy("timestamp", "desc")
                .limit(count)
                .get();
            
            const memories = [];
            snapshot.forEach(doc => {
                memories.push({ id: doc.id, ...doc.data() });
            });
            
            return memories;
            
        } catch (error) {
            console.error("Error getting memories:", error);
            return [];
        }
    }
    
    function getSessionId() {
        let sessionId = localStorage.getItem("cephasgm_session");
        
        if (!sessionId) {
            sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
            localStorage.setItem("cephasgm_session", sessionId);
        }
        
        return sessionId;
    }
    
    function clearLocalMemory() {
        if (confirm("Clear all local memory?")) {
            localStorage.removeItem("chatHistory");
            localStorage.removeItem("cephasgm_session");
            alert("Local memory cleared");
        }
    }
    
    // Initialize Firebase on load
    initialize();
    
    // Public API
    return {
        saveMemory,
        searchMemories,
        getRecentMemories,
        clearLocalMemory
    };
})();

// Make available globally
window.saveMemory = window.MemoryModule.saveMemory;
window.searchMemories = window.MemoryModule.searchMemories;
window.getRecentMemories = window.MemoryModule.getRecentMemories;
window.clearLocalMemory = window.MemoryModule.clearLocalMemory;
