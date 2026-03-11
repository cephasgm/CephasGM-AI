const functions = require("firebase-functions");
const fetch = require("node-fetch");

/**
 * Image Generation
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/image
 */
exports.image = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const { prompt, size = "512x512", n = 1 } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }

    // For demo/development without actual API key, use placeholder images
    const openAIKey = process.env.OPENAI_KEY;
    let imageUrl;

    if (openAIKey && openAIKey !== "sk-demo-key") {
      // Real OpenAI API call
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAIKey}`
        },
        body: JSON.stringify({
          model: "dall-e-2",
          prompt: prompt,
          n: n,
          size: size
        })
      });

      const data = await response.json();
      
      if (data.data && data.data.length > 0) {
        imageUrl = data.data[0].url;
      } else {
        throw new Error("No image generated");
      }
    } else {
      // Mock image URLs for development (placeholders)
      const seed = prompt.length + Date.now();
      imageUrl = `https://picsum.photos/seed/${seed}/${size.split('x')[0]}/${size.split('x')[1]}`;
    }

    res.json({
      success: true,
      url: imageUrl,
      prompt: prompt,
      size: size,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error("Image generation error:", error);
    res.status(500).json({ 
      error: "Image generation failed", 
      url: `https://via.placeholder.com/512x512?text=${encodeURIComponent("Image+Generation+Failed")}`,
      details: error.message
    });
  }
});
