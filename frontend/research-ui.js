/**
 * Research UI - Autonomous research interface
 */

// DOM elements
let researchTopic, researchDepth, researchBtn, researchResult;

document.addEventListener('DOMContentLoaded', function() {
  researchTopic = document.getElementById('researchTopic');
  researchDepth = document.getElementById('researchDepth');
  researchBtn = document.getElementById('researchBtn');
  researchResult = document.getElementById('researchResult');
  
  if (researchBtn) {
    researchBtn.addEventListener('click', conductResearch);
  }
  
  if (researchTopic) {
    researchTopic.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        conductResearch();
      }
    });
  }
});

/**
 * Conduct research on a topic
 */
async function conductResearch() {
  if (!researchTopic || !researchResult) return;
  
  const topic = researchTopic.value.trim();
  
  if (!topic) {
    showResearchResult('Please enter a research topic', 'error');
    return;
  }

  const depth = researchDepth?.value || 'basic';
  
  showResearchResult(`🔍 Researching "${topic}"...`, 'info');
  researchBtn.disabled = true;
  researchBtn.textContent = 'Researching...';

  try {
    const response = await fetch('/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        topic: topic,
        options: { depth: depth }
      })
    });

    const data = await response.json();
    
    if (data.success) {
      displayResearchResults(data);
    } else {
      showResearchResult(`Error: ${data.error || 'Research failed'}`, 'error');
    }

  } catch (error) {
    console.error('Research error:', error);
    showResearchResult(`Failed to conduct research: ${error.message}`, 'error');
    
  } finally {
    researchBtn.disabled = false;
    researchBtn.textContent = 'Conduct Research';
  }
}

/**
 * Display research results
 */
function displayResearchResults(data) {
  if (!researchResult) return;
  
  const result = data.result || data;
  
  let html = `
    <div class="research-results">
      <h3>📚 Research Results: ${result.topic || 'Topic'}</h3>
      <p class="timestamp">${new Date(data.timestamp || Date.now()).toLocaleString()}</p>
  `;

  // Summary section
  if (result.summary) {
    html += `
      <div class="research-section">
        <h4>📝 Summary</h4>
        <div class="summary-content">${result.summary}</div>
      </div>
    `;
  }

  // Sources section
  if (result.sources && result.sources.length > 0) {
    html += `
      <div class="research-section">
        <h4>🔍 Sources</h4>
        <div class="sources-list">
    `;
    
    result.sources.forEach(source => {
      html += `
        <div class="source-item">
          <h5>${source.type.toUpperCase()}</h5>
          ${source.data.title ? `<p><strong>${source.data.title}</strong></p>` : ''}
          ${source.data.extract ? `<p>${source.data.extract.substring(0, 200)}...</p>` : ''}
        </div>
      `;
    });
    
    html += '</div></div>';
  }

  // Related topics
  if (result.related && result.related.length > 0) {
    html += `
      <div class="research-section">
        <h4>🔗 Related Topics</h4>
        <div class="related-topics">
          ${result.related.map(topic => `
            <span class="topic-tag" onclick="researchTopic.value='${topic}'">${topic}</span>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Raw data (collapsible)
  html += `
    <div class="research-section">
      <details>
        <summary>📊 Raw Data</summary>
        <pre class="raw-data">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
      </details>
    </div>
  `;

  html += '</div>';
  
  researchResult.innerHTML = html;
}

/**
 * Show simple research message
 */
function showResearchResult(message, type = 'info') {
  if (!researchResult) return;
  
  researchResult.innerHTML = `
    <div class="research-${type}">
      <p>${message}</p>
    </div>
  `;
}

/**
 * Export research as markdown
 */
function exportResearch() {
  const content = researchResult?.innerText;
  if (!content) return;
  
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Share research results
 */
function shareResearch() {
  const text = researchResult?.innerText;
  if (!text) return;
  
  if (navigator.share) {
    navigator.share({
      title: 'CephasGM AI Research',
      text: text.substring(0, 500),
      url: window.location.href
    }).catch(console.error);
  } else {
    alert('Share not supported on this browser');
  }
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export functions
window.conductResearch = conductResearch;
window.exportResearch = exportResearch;
window.shareResearch = shareResearch;
