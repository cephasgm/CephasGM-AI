/**
 * Image Generation
 * Fixed - Uses global namespace pattern
 */

window.ImageModule = window.ImageModule || (function() {
    const API_URL = window.CEPHASGM_CONFIG?.API_URL || "https://cephasgm-ai.onrender.com";
    
    let imagePrompt, generateBtn, imageResult, imageStatus;
    
    function init() {
        imagePrompt = document.getElementById("imagePrompt");
        generateBtn = document.getElementById("generateImageBtn");
        imageResult = document.getElementById("imageResult");
        imageStatus = document.getElementById("imageStatus");

        if (generateBtn) {
            generateBtn.addEventListener('click', generateImage);
        }

        if (imagePrompt) {
            imagePrompt.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    generateImage();
                }
            });
        }
    }
    
    async function generateImage() {
        if (!imagePrompt) return;
        
        const prompt = imagePrompt.value.trim();
        
        if (!prompt) {
            showStatus("Please enter an image description", "error");
            return;
        }

        // Disable button and show loading
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.textContent = "Generating...";
        }

        showStatus("Generating image...", "info");

        try {
            // First try the local backend
            const response = await fetch(`${API_URL}/api/generate/image`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    prompt: prompt,
                    model: "dall-e-2",
                    size: "512x512",
                    n: 1
                })
            });

            if (!response.ok) {
                // Fallback to Firebase function
                return await fallbackGenerateImage(prompt);
            }

            const data = await response.json();
            
            if (data.url && imageResult) {
                displayImage(data.url, prompt);
                showStatus("Image generated successfully!", "success");
            } else {
                showStatus("Failed to generate image", "error");
            }

        } catch (error) {
            console.error("Image generation error:", error);
            // Try fallback
            await fallbackGenerateImage(prompt);
            
        } finally {
            // Re-enable button
            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = "Generate Image";
            }
        }
    }
    
    async function fallbackGenerateImage(prompt) {
        try {
            const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/image", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    prompt: prompt,
                    size: "512x512",
                    n: 1
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.url && imageResult) {
                displayImage(data.url, prompt);
                showStatus("Image generated successfully (via fallback)!", "success");
            }
            
        } catch (fallbackError) {
            console.error("Fallback also failed:", fallbackError);
            showStatus("Error generating image. Please try again.", "error");
            
            if (imageResult) {
                imageResult.innerHTML = `<div class="error-placeholder">
                    <p>😕 Image generation failed</p>
                    <small>${fallbackError.message}</small>
                </div>`;
            }
        }
    }
    
    function displayImage(url, prompt) {
        if (!imageResult) return;
        
        // Create image element
        const img = document.createElement("img");
        img.src = url;
        img.alt = prompt;
        img.className = "generated-image";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "8px";
        
        // Clear previous image
        imageResult.innerHTML = "";
        imageResult.appendChild(img);
        
        // Add download button
        addDownloadButton(url, prompt);
    }
    
    function addDownloadButton(imageUrl, prompt) {
        const container = document.createElement("div");
        container.className = "image-actions";
        container.style.marginTop = "10px";
        container.style.display = "flex";
        container.style.gap = "10px";
        
        const downloadBtn = document.createElement("button");
        downloadBtn.textContent = "Download Image";
        downloadBtn.className = "download-btn";
        downloadBtn.onclick = function() {
            downloadImage(imageUrl, prompt);
        };
        
        const regenerateBtn = document.createElement("button");
        regenerateBtn.textContent = "Regenerate";
        regenerateBtn.className = "regenerate-btn";
        regenerateBtn.onclick = generateImage;
        
        container.appendChild(downloadBtn);
        container.appendChild(regenerateBtn);
        
        if (imageResult) {
            imageResult.appendChild(container);
        }
    }
    
    function downloadImage(url, filename) {
        fetch(url)
            .then(response => response.blob())
            .then(blob => {
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `cephasgm-${filename.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}.jpg`;
                link.click();
                URL.revokeObjectURL(link.href);
            })
            .catch(error => {
                console.error("Download error:", error);
                showStatus("Failed to download image", "error");
            });
    }
    
    function showStatus(message, type) {
        if (!imageStatus) return;
        
        imageStatus.textContent = message;
        imageStatus.className = `status ${type}`;
        
        // Clear after 3 seconds for success messages
        if (type === "success") {
            setTimeout(() => {
                if (imageStatus) {
                    imageStatus.textContent = "";
                    imageStatus.className = "status";
                }
            }, 3000);
        }
    }
    
    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Public API
    return {
        generateImage
    };
})();

// Export for global use
window.generateImage = window.ImageModule.generateImage;
