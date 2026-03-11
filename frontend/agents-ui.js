/**
 * Agents UI - Frontend for AI agent interaction
 */

// DOM elements
let agentTaskInput, agentResultDiv, agentSelect, agentStatus;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  agentTaskInput = document.getElementById('agentTask');
  agentResultDiv = document.getElementById('agentResult');
  agentSelect = document.getElementById('agentSelect');
  agentStatus = document.getElementById('agentStatus');
  
  // Add event listeners
  const sendBtn = document.getElementById('sendAgentBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      const task = agentTaskInput?.value;
      if (task) sendAgentTask(task);
    });
  }
  
  // Load available agents
  loadAgents();
});

/**
 * Load available agents from backend
 */
async function loadAgents() {
  try {
    showStatus('Loading agents...', 'info');
    
    const response = await fetch('/agents');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const agents = await response.json();
    
    if (agentSelect && agents.length > 0) {
      agentSelect.innerHTML = agents.map(agent => 
        `<option value="${agent.name}">${agent.name} - ${Array.isArray(agent.capabilities) ? agent.capabilities.join(', ') : 'general'}</option>`
      ).join('');
      showStatus(`Loaded ${agents.length} agents`, 'success');
    } else if (agentSelect) {
      agentSelect.innerHTML = '<option value="auto">Auto-select agent</option>';
    }
    
  } catch (error) {
    console.error('Failed to load agents:', error);
    showStatus(`Error loading agents: ${error.message}`, 'error');
  }
}

/**
 * Send task to agent manager
 */
async function sendAgentTask(task) {
  if (!task || task.trim() === '') {
    showStatus('Please enter a task', 'error');
    return;
  }

  showStatus('Processing task...', 'info');
  if (agentResultDiv) {
    agentResultDiv.innerHTML = '<div class="loading">⏳ Processing...</div>';
  }

  try {
    const selectedAgent = agentSelect ? agentSelect.value : 'auto';
    
    const response = await fetch('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        task: task,
        params: { agent: selectedAgent }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      displayAgentResult(data);
      showStatus('Task completed successfully!', 'success');
    } else {
      showStatus(`Error: ${data.error || 'Unknown error'}`, 'error');
      displayError(data.error || 'Task failed');
    }

  } catch (error) {
    console.error('Agent task error:', error);
    showStatus(`Failed to process task: ${error.message}`, 'error');
    displayError(error.message);
  }
}

/**
 * Display agent result
 */
function displayAgentResult(data) {
  if (!agentResultDiv) return;
  
  const result = data.result || data;
  
  let html = `
    <div class="agent-success">
      <h4>✅ Task Completed</h4>
      <p><strong>Agent:</strong> ${data.agent || 'Auto-selected'}</p>
      <p><strong>Execution Time:</strong> ${data.executionTime || 'N/A'}</p>
  `;

  // Handle different result types
  if (typeof result === 'object') {
    html += '<div class="agent-data">';
    
    // Check for code output
    if (result.code) {
      html += `<pre class="code-block"><code>${escapeHtml(result.code)}</code></pre>`;
    }
    
    // Check for summary
    if (result.summary) {
      html += `<div class="summary"><strong>Summary:</strong> ${result.summary}</div>`;
    }
    
    // Check for explanation
    if (result.explanation) {
      html += `<div class="explanation"><strong>Explanation:</strong> ${result.explanation}</div>`;
    }
    
    // Check for issues/fixes (debugging output)
    if (result.issues && result.issues.length > 0) {
      html += '<div class="issues"><strong>Issues Found:</strong><ul>';
      result.issues.forEach(issue => {
        html += `<li>${issue}</li>`;
      });
      html += '</ul></div>';
      
      if (result.fixes && result.fixes.length > 0) {
        html += '<div class="fixes"><strong>Suggested Fixes:</strong><ul>';
        result.fixes.forEach(fix => {
          html += `<li>${fix}</li>`;
        });
        html += '</ul></div>';
      }
    }
    
    // Check for review results
    if (result.review) {
      html += '<div class="review"><strong>Code Review:</strong>';
      if (result.review.style) {
        html += `<p>Style Score: ${result.review.style.score}/10</p>`;
      }
      if (result.review.performance) {
        html += `<p>Performance Score: ${result.review.performance.score}/10</p>`;
      }
      if (result.review.security) {
        html += `<p>Security Score: ${result.review.security.score}/10</p>`;
      }
      html += '</div>';
    }
    
    // Generic object display
    html += '<pre class="json-display">' + escapeHtml(JSON.stringify(result, null, 2)) + '</pre>';
    html += '</div>';
  } else {
    html += `<p class="simple-result">${result}</p>`;
  }
  
  html += `<p class="timestamp">${new Date(data.timestamp || Date.now()).toLocaleString()}</p>`;
  html += '</div>';
  
  agentResultDiv.innerHTML = html;
}

/**
 * Display error message
 */
function displayError(message) {
  if (!agentResultDiv) return;
  
  agentResultDiv.innerHTML = `
    <div class="agent-error">
      <h4>❌ Error</h4>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  if (!agentStatus) return;
  
  agentStatus.textContent = message;
  agentStatus.className = `status ${type}`;
  
  // Clear success messages after 5 seconds
  if (type === 'success') {
    setTimeout(() => {
      if (agentStatus) {
        agentStatus.textContent = '';
        agentStatus.className = 'status';
      }
    }, 5000);
  }
}

/**
 * Run research agent
 */
async function runResearchAgent() {
  const topic = agentTaskInput?.value || 'artificial intelligence in Africa';
  await sendAgentTask(`research ${topic}`);
}

/**
 * Run coding agent
 */
async function runCodingAgent() {
  const task = agentTaskInput?.value || 'write a function to calculate fibonacci';
  await sendAgentTask(`code ${task}`);
}

/**
 * Run automation agent
 */
async function runAutomationAgent() {
  const task = agentTaskInput?.value || 'automate backup process';
  await sendAgentTask(`automate ${task}`);
}

/**
 * Run custom agent task
 */
async function runCustomAgent() {
  const task = agentTaskInput?.value;
  if (!task) {
    showStatus('Please enter a task', 'error');
    return;
  }
  await sendAgentTask(task);
}

/**
 * Clear result
 */
function clearResult() {
  if (agentResultDiv) {
    agentResultDiv.innerHTML = '';
  }
  if (agentStatus) {
    agentStatus.textContent = '';
    agentStatus.className = 'status';
  }
  if (agentTaskInput) {
    agentTaskInput.value = '';
  }
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Export functions for global use
window.sendAgentTask = sendAgentTask;
window.runResearchAgent = runResearchAgent;
window.runCodingAgent = runCodingAgent;
window.runAutomationAgent = runAutomationAgent;
window.runCustomAgent = runCustomAgent;
window.clearResult = clearResult;
window.loadAgents = loadAgents;
