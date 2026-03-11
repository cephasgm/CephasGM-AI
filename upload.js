/**
 * File Upload Handler
 */

let fileInput, uploadBtn, uploadStatus, uploadProgress;

document.addEventListener('DOMContentLoaded', function() {
  fileInput = document.getElementById("file");
  uploadBtn = document.getElementById("uploadBtn");
  uploadStatus = document.getElementById("uploadStatus");
  uploadProgress = document.getElementById("uploadProgress");

  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadFile);
  }

  if (fileInput) {
    fileInput.addEventListener('change', handleFileSelect);
  }
});

function handleFileSelect(event) {
  const file = event.target.files[0];
  
  if (!file) return;
  
  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    showStatus(`File too large. Max size: 10MB`, "error");
    fileInput.value = "";
    return;
  }
  
  // Show file info
  showStatus(`Selected: ${file.name} (${formatFileSize(file.size)})`, "info");
}

async function uploadFile() {
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showStatus("Please select a file first", "error");
    return;
  }

  const file = fileInput.files[0];
  
  // Validate file type
  const allowedTypes = [
    'application/pdf', 
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ];
  
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(pdf|txt|doc|docx|jpg|jpeg|png)$/i)) {
    showStatus("File type not supported. Please upload PDF, TXT, DOC, DOCX, JPG, or PNG", "error");
    return;
  }

  // Disable button
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";
  }

  if (uploadProgress) {
    uploadProgress.value = 0;
    uploadProgress.style.display = "block";
  }

  showStatus("Uploading file...", "info");

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("filename", file.name);
    formData.append("type", file.type);

    // Simulate progress
    simulateProgress();

    const response = await fetch("https://us-central1-cephasgm-ai.cloudfunctions.net/documentAI", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    // Complete progress
    if (uploadProgress) {
      uploadProgress.value = 100;
    }

    showStatus(`✅ Upload successful! File: ${result.fileName || file.name}`, "success");
    
    // Display file info
    displayFileInfo(result);
    
    // Clear file input
    if (fileInput) {
      fileInput.value = "";
    }

  } catch(error) {
    console.error("Upload error:", error);
    showStatus(`❌ Upload failed: ${error.message}`, "error");
    
    if (uploadProgress) {
      uploadProgress.style.display = "none";
    }
    
  } finally {
    // Re-enable button
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload File";
    }
  }
}

function simulateProgress() {
  if (!uploadProgress) return;
  
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    if (progress <= 90) {
      uploadProgress.value = progress;
    } else {
      clearInterval(interval);
    }
  }, 200);
  
  // Store interval to clear later
  window.uploadProgressInterval = interval;
}

function displayFileInfo(result) {
  const infoDiv = document.getElementById("fileInfo");
  if (!infoDiv) return;
  
  let html = `<div class="file-info success">`;
  html += `<h4>File processed:</h4>`;
  html += `<p><strong>Name:</strong> ${result.fileName || 'Unknown'}</p>`;
  
  if (result.pageCount) {
    html += `<p><strong>Pages:</strong> ${result.pageCount}</p>`;
  }
  
  if (result.wordCount) {
    html += `<p><strong>Words:</strong> ${result.wordCount}</p>`;
  }
  
  if (result.summary) {
    html += `<p><strong>Summary:</strong> ${result.summary}</p>`;
  }
  
  html += `<p><small>Processed at: ${new Date(result.timestamp || Date.now()).toLocaleString()}</small></p>`;
  html += `</div>`;
  
  infoDiv.innerHTML = html;
}

function showStatus(message, type) {
  if (!uploadStatus) return;
  
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status ${type}`;
  
  // Clear success messages after 5 seconds
  if (type === "success") {
    setTimeout(() => {
      if (uploadStatus) {
        uploadStatus.textContent = "";
        uploadStatus.className = "upload-status";
      }
    }, 5000);
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Export functions
window.uploadFile = uploadFile;
