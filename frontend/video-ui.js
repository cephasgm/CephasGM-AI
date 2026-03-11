/**
 * Video UI - Video generation interface
 */

// DOM elements
let videoPrompt, videoDuration, videoResolution, generateVideoBtn, videoResult, videoStatus;

document.addEventListener('DOMContentLoaded', function() {
  videoPrompt = document.getElementById('videoPrompt');
  videoDuration = document.getElementById('videoDuration');
  videoResolution = document.getElementById('videoResolution');
  generateVideoBtn = document.getElementById('generateVideoBtn');
  videoResult = document.getElementById('videoResult');
  videoStatus = document.getElementById('videoStatus');
  
  if (generateVideoBtn) {
    generateVideoBtn.addEventListener('click', generateVideo);
  }
  
  if (videoPrompt) {
    videoPrompt.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        generateVideo();
      }
    });
  }
});

/**
 * Generate video from prompt
 */
async function generateVideo() {
  if (!videoPrompt) return;
  
  const prompt = videoPrompt.value.trim();
  
  if (!prompt) {
    showVideoStatus('Please enter a video description', 'error');
    return;
  }

  const duration = parseInt(videoDuration?.value || '5');
  const resolution = videoResolution?.value || '1024x576';
  
  showVideoStatus('🎬 Generating video... This may take a moment', 'info');
  generateVideoBtn.disabled = true;
  generateVideoBtn.textContent = 'Generating...';

  try {
    const response = await fetch('/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: prompt,
        options: {
          duration: duration,
          resolution: resolution,
          provider: 'runwayml'
        }
      })
    });

    const data = await response.json();
    
    if (data.success) {
      displayVideo(data);
    } else {
      showVideoStatus(`Error: ${data.error || 'Generation failed'}`, 'error');
    }

  } catch (error) {
    console.error('Video generation error:', error);
    showVideoStatus(`Failed to generate video: ${error.message}`, 'error');
    
  } finally {
    generateVideoBtn.disabled = false;
    generateVideoBtn.textContent = 'Generate Video';
  }
}

/**
 * Display generated video
 */
function displayVideo(data) {
  if (!videoResult || !videoStatus) return;
  
  const videoUrl = data.url || (data.result?.url);
  
  let html = `
    <div class="video-container">
      <h4>✅ Video Generated</h4>
      <p><strong>Prompt:</strong> ${data.prompt || 'Video'}</p>
      <p><strong>Duration:</strong> ${data.duration || 5}s</p>
      <p><strong>Resolution:</strong> ${data.resolution || '1024x576'}</p>
  `;

  if (videoUrl) {
    // Check if it's a real video URL or placeholder
    if (videoUrl.includes('.mp4') || videoUrl.includes('storage.googleapis.com')) {
      html += `
        <video controls width="100%" poster="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100%' height='300'><rect width='100%' height='100%' fill='%23333'/><text x='50%' y='50%' fill='%23ffb300' text-anchor='middle' dy='.3em'>Loading video...</text></svg>">
          <source src="${videoUrl}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      `;
    } else {
      // Placeholder image
      html += `
        <div class="video-placeholder">
          <img src="${videoUrl}" alt="Video placeholder" style="max-width:100%; border-radius:10px;">
          <p class="note">🎬 Video preview (demo mode)</p>
        </div>
      `;
    }
  } else {
    html += '<p class="error">Video URL not available</p>';
  }

  // Add download button
  if (videoUrl) {
    html += `
      <div class="video-actions">
        <button onclick="downloadVideo('${videoUrl}')" class="download-btn">⬇️ Download</button>
        <button onclick="shareVideo('${videoUrl}')" class="share-btn">📤 Share</button>
      </div>
    `;
  }

  html += `<p class="timestamp">Generated: ${new Date(data.timestamp || Date.now()).toLocaleString()}</p>`;
  html += '</div>';
  
  videoResult.innerHTML = html;
  showVideoStatus('Video generated successfully!', 'success');
}

/**
 * Show status message
 */
function showVideoStatus(message, type = 'info') {
  if (!videoStatus) return;
  
  videoStatus.textContent = message;
  videoStatus.className = `status ${type}`;
  
  if (type === 'success') {
    setTimeout(() => {
      videoStatus.textContent = '';
      videoStatus.className = 'status';
    }, 5000);
  }
}

/**
 * Download video
 */
function downloadVideo(url, filename = 'cephasgm-video.mp4') {
  if (!url) return;
  
  // For demo/placeholder images, just show message
  if (url.includes('via.placeholder.com') || url.includes('placeholder')) {
    alert('Demo mode: Video download simulated. In production, this would download the actual video.');
    return;
  }
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

/**
 * Share video
 */
function shareVideo(url) {
  if (navigator.share) {
    navigator.share({
      title: 'CephasGM AI Generated Video',
      text: 'Check out this AI-generated video!',
      url: url
    }).catch(console.error);
  } else {
    // Fallback: copy link to clipboard
    navigator.clipboard.writeText(url).then(() => {
      alert('Video link copied to clipboard!');
    }).catch(() => {
      alert('Share not supported on this browser');
    });
  }
}

/**
 * Regenerate video with same prompt
 */
function regenerateVideo() {
  if (videoPrompt?.value) {
    generateVideo();
  }
}

/**
 * Clear video result
 */
function clearVideo() {
  if (videoResult) {
    videoResult.innerHTML = '';
  }
  if (videoStatus) {
    videoStatus.textContent = '';
    videoStatus.className = 'status';
  }
}

/**
 * Load sample prompts
 */
function loadSamplePrompt(index = 0) {
  const samples = [
    'A beautiful African sunset over the savanna with wildlife',
    'Futuristic African city with flying cars and green technology',
    'Traditional African dance performance in vibrant colors',
    'Space launch from a spaceport in Kenya',
    'Underwater exploration off the coast of South Africa'
  ];
  
  if (videoPrompt) {
    videoPrompt.value = samples[index % samples.length];
  }
}

// Export functions
window.generateVideo = generateVideo;
window.downloadVideo = downloadVideo;
window.shareVideo = shareVideo;
window.regenerateVideo = regenerateVideo;
window.clearVideo = clearVideo;
window.loadSamplePrompt = loadSamplePrompt;
