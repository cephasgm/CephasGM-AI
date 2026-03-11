async function askAI(message) {
  try {

    const response = await fetch(
      "https://us-central1-cephasgm-ai.cloudfunctions.net/aiChat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: message
        })
      }
    );

    const data = await response.json();

    return data.reply;

  } catch (error) {
    console.error("AI Error:", error);
    return "AI service unavailable.";
  }
}

// Export for use in app.js
window.askAI = askAI;
