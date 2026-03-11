/**
 * Image Generation
 */

let imagePrompt, generateBtn, imageResult, imageStatus;

document.addEventListener('DOMContentLoaded', function() {
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
});

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
      // Create image element
      const img = document.createElement("img");
      img.src = data.url;
      img.alt = prompt;
      img.className = "generated-image";
      img.onload = function() {
        showStatus("Image generated successfully!", "success");
      };
      
      // Clear previous image
      imageResult.innerHTML = "";
      imageResult.appendChild(img);
      
      // Add download button
      addDownloadButton(data.url, prompt);
      
    } else {
      showStatus("Failed to generate image", "error");
    }

  } catch (error) {
    console.error("Image generation error:", error);
    showStatus("Error generating image. Please try again.", "error");
    
    // Show placeholder on error
    if (imageResult) {
      imageResult.innerHTML = `<div class="error-placeholder">
        <p>😕 Image generation failed</p>
        <small>${error.message}</small>
      </div>`;
    }
    
  } finally {
    // Re-enable button
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = "Generate Image";
    }
  }
}

function addDownloadButton(imageUrl, prompt) {
  const container = document.createElement("div");
  container.className = "image-actions";
  
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
      link.download = `cephasgm-${filename.substring(0, 20)}.jpg`;
      link.click();
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
      imageStatus.textContent = "";
      imageStatus.className = "status";
    }, 3000);
  }
}

// Export functions
window.generateImage = generateImage;
