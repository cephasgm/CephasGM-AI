/**
 * File Upload Handler - Supports multiple files and AI interpretation
 */
window.UploadModule = window.UploadModule || (function() {
    const API_BASE = window.CEPHASGM_CONFIG?.API_URL || 'https://cephasgm-ai.onrender.com';
    
    let fileInput, uploadBtn, uploadStatus, uploadProgress, progressFill, fileInfo;
    
    function init() {
        fileInput = document.getElementById("file");
        uploadBtn = document.getElementById("uploadBtn");
        uploadStatus = document.getElementById("uploadStatus");
        uploadProgress = document.getElementById("uploadProgress");
        progressFill = document.getElementById("uploadProgressFill");
        fileInfo = document.getElementById("fileInfo");

        if (uploadBtn) {
            uploadBtn.addEventListener('click', uploadFiles);
        }

        if (fileInput) {
            fileInput.addEventListener('change', handleFileSelect);
            // Allow multiple files
            fileInput.setAttribute('multiple', 'true');
        }
    }

    function handleFileSelect(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        let message = `Selected ${files.length} file(s):\n`;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // Validate each file size (max 10MB)
            const maxSize = 10 * 1024 * 1024;
            if (file.size > maxSize) {
                showUploadStatus(`File ${file.name} too large. Max 10MB.`, "error");
                fileInput.value = "";
                return;
            }
            message += `- ${file.name} (${formatFileSize(file.size)})\n`;
        }
        showUploadStatus(message, "info");
    }

    async function uploadFiles() {
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showUploadStatus("Please select at least one file", "error");
            return;
        }

        const files = fileInput.files;
        showUploadStatus(`Uploading ${files.length} file(s)...`, "info");
        uploadBtn.disabled = true;

        // Show progress bar
        uploadProgress.style.display = 'block';
        progressFill.style.width = '0%';

        const results = [];
        let completed = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const result = await processSingleFile(file, i, files.length);
                results.push(result);
            } catch (error) {
                console.error(`Error processing ${file.name}:`, error);
                results.push({ fileName: file.name, error: error.message });
            }
            completed++;
            progressFill.style.width = `${(completed / files.length) * 100}%`;
        }

        setTimeout(() => {
            uploadProgress.style.display = 'none';
            progressFill.style.width = '0%';
        }, 500);

        showUploadStatus(`Processed ${results.length} file(s)`, "success");
        displayResults(results);

        uploadBtn.disabled = false;
        // Clear input
        fileInput.value = '';
    }

    async function processSingleFile(file, index, total) {
        const formData = new FormData();
        formData.append('file', file);

        // 1. Upload to backend (optional)
        let uploadResult = null;
        try {
            const response = await fetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData,
                mode: 'cors',
                headers: { 'Accept': 'application/json' }
            });
            if (response.ok) {
                uploadResult = await response.json();
            }
        } catch (e) {
            console.log(`Upload to backend failed for ${file.name}:`, e);
        }

        // 2. Read file content for text files
        let fileContent = '';
        if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
            fileContent = await file.text();
        } else if (file.type === 'application/pdf') {
            fileContent = '[PDF content – analysis not implemented]';
        } else if (file.type.startsWith('image/')) {
            fileContent = '[Image file – analysis not implemented]';
        }

        // 3. Send to AI for interpretation if content exists
        let interpretation = '';
        if (fileContent && fileContent.length > 50) {
            try {
                const aiResponse = await fetch(`${API_BASE}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt: `Analyze this document and provide a concise summary:\n\n${fileContent.substring(0, 3000)}`,
                        model: 'gpt-3.5-turbo'
                    })
                });
                if (aiResponse.ok) {
                    const data = await aiResponse.json();
                    interpretation = data.content || data.response || 'No interpretation';
                }
            } catch (e) {
                console.log('AI interpretation failed:', e);
                interpretation = 'Interpretation unavailable.';
            }
        }

        return {
            fileName: file.name,
            size: file.size,
            type: file.type,
            uploadResult,
            contentPreview: fileContent.substring(0, 500) + (fileContent.length > 500 ? '...' : ''),
            interpretation
        };
    }

    function displayResults(results) {
        if (!fileInfo) return;
        let html = '<h3>Upload Results</h3>';
        results.forEach(r => {
            html += `<div style="margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 5px;">`;
            html += `<strong>📄 ${r.fileName}</strong> (${formatFileSize(r.size)})<br>`;
            if (r.error) {
                html += `<span style="color: #ff6b6b;">❌ Error: ${r.error}</span>`;
            } else {
                if (r.interpretation) {
                    html += `<p><em>Interpretation:</em> ${r.interpretation}</p>`;
                }
                if (r.contentPreview) {
                    html += `<details><summary>Preview</summary><pre style="background: #222; padding: 5px; max-height: 200px; overflow: auto;">${escapeHtml(r.contentPreview)}</pre></details>`;
                }
            }
            html += `</div>`;
        });
        fileInfo.innerHTML = html;
    }

    function escapeHtml(text) {
        return text.replace(/[&<>"]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    function showUploadStatus(message, type) {
        if (!uploadStatus) return;
        uploadStatus.textContent = message;
        uploadStatus.className = `upload-status ${type}`;
        if (type === "success") {
            setTimeout(() => {
                uploadStatus.textContent = "";
                uploadStatus.className = "upload-status";
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { uploadFiles: uploadFiles };
})();

// For backward compatibility
window.uploadFile = window.UploadModule.uploadFiles;
