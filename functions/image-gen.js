const functions = require("firebase-functions");
const fetch = require("node-fetch");
const cors = require("cors")({ origin: true });

/**
 * Image Generation
 * Endpoint: https://us-central1-cephasgm-ai.cloudfunctions.net/image
 */
exports.image = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    // Set CORS headers
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
      const { prompt, size = "512x512", n = 1, provider = "auto" } = req.body;

      if (!prompt) {
        res.status(400).json({ error: "Prompt is required" });
        return;
      }

      let imageUrl;
      let usedProvider = "fallback";

      // Try Stability AI first if key exists and provider allows
      const stabilityKey = process.env.STABILITY_KEY;
      if ((provider === "auto" || provider === "stability") && stabilityKey) {
        try {
          const [width, height] = size.split('x').map(Number);
          const response = await fetch("https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${stabilityKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              text_prompts: [{ text: prompt, weight: 1.0 }],
              cfg_scale: 7,
              height: height || 512,
              width: width || 512,
              samples: n,
              steps: 30
            })
          });

          if (response.ok) {
            const data = await response.json();
            if (data.artifacts && data.artifacts.length > 0) {
              // Return the first image as base64 data URL
              const base64 = data.artifacts[0].base64;
              imageUrl = `data:image/png;base64,${base64}`;
              usedProvider = "stability";
            }
          } else {
            console.warn("Stability AI failed, falling back to OpenAI");
          }
        } catch (e) {
          console.warn("Stability AI error:", e.message);
        }
      }

      // If Stability didn't work, try OpenAI DALL·E
      if (!imageUrl && (provider === "auto" || provider === "openai")) {
        const openAIKey = process.env.OPENAI_API_KEY;
        if (openAIKey) {
          try {
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

            if (response.ok) {
              const data = await response.json();
              if (data.data && data.data.length > 0) {
                imageUrl = data.data[0].url;
                usedProvider = "openai";
              }
            }
          } catch (e) {
            console.warn("OpenAI image error:", e.message);
          }
        }
      }

      // Final fallback – placeholder
      if (!imageUrl) {
        const seed = prompt.length + Date.now();
        const [w, h] = size.split('x');
        imageUrl = `https://picsum.photos/seed/${seed}/${w || 512}/${h || 512}`;
        usedProvider = "placeholder";
      }

      res.json({
        success: true,
        url: imageUrl,
        prompt: prompt,
        size: size,
        provider: usedProvider,
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
});
