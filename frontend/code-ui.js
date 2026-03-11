/**
 * Code UI - Code interpreter interface
 */

// DOM elements
let codeInput, codeLanguage, codeOutput, runCodeBtn;

document.addEventListener('DOMContentLoaded', function() {
  codeInput = document.getElementById('codeInput');
  codeLanguage = document.getElementById('codeLanguage');
  codeOutput = document.getElementById('codeOutput');
  runCodeBtn = document.getElementById('runCodeBtn');
  
  if (runCodeBtn) {
    runCodeBtn.addEventListener('click', runCode);
  }
  
  if (codeInput) {
    codeInput.addEventListener('keydown', handleTabKey);
  }
  
  // Load sample code
  loadSampleCode();
});

/**
 * Run code in interpreter
 */
async function runCode() {
  if (!codeInput || !codeOutput) return;
  
  const code = codeInput.value.trim();
  const language = codeLanguage?.value || 'javascript';
  
  if (!code) {
    showOutput('Please enter some code to run', 'error');
    return;
  }

  showOutput('Executing code...', 'info');
  runCodeBtn.disabled = true;
  runCodeBtn.textContent = 'Running...';

  try {
    const response = await fetch('/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        code: code,
        options: { language: language }
      })
    });

    const data = await response.json();
    
    if (data.success) {
      displayCodeOutput(data);
    } else {
      showOutput(`Error: ${data.error || 'Execution failed'}`, 'error');
    }

  } catch (error) {
    console.error('Code execution error:', error);
    showOutput(`Failed to execute code: ${error.message}`, 'error');
    
  } finally {
    runCodeBtn.disabled = false;
    runCodeBtn.textContent = 'Run Code';
  }
}

/**
 * Display code execution output
 */
function displayCodeOutput(data) {
  if (!codeOutput) return;
  
  let html = `
    <div class="execution-result">
      <h4>✅ Execution Complete</h4>
      <p><strong>Language:</strong> ${data.language || 'javascript'}</p>
      <p><strong>Time:</strong> ${data.executionTime || 'N/A'}</p>
  `;

  if (data.output) {
    html += `<div class="output-section">
      <h5>Output:</h5>
      <pre class="output">${escapeHtml(data.output)}</pre>
    </div>`;
  }

  if (data.error) {
    html += `<div class="error-section">
      <h5>Error:</h5>
      <pre class="error">${escapeHtml(data.error)}</pre>
    </div>`;
  }

  if (data.explanation) {
    html += `<div class="explanation">
      <p>${data.explanation}</p>
    </div>`;
  }

  html += `<p class="timestamp">${new Date(data.timestamp || Date.now()).toLocaleString()}</p>`;
  html += '</div>';
  
  codeOutput.innerHTML = html;
}

/**
 * Show simple output message
 */
function showOutput(message, type = 'info') {
  if (!codeOutput) return;
  
  codeOutput.innerHTML = `
    <div class="output-${type}">
      <p>${message}</p>
    </div>
  `;
}

/**
 * Handle tab key in textarea (insert spaces)
 */
function handleTabKey(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    
    const start = this.selectionStart;
    const end = this.selectionEnd;
    
    // Insert 2 spaces for tab
    this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
    
    // Move cursor position
    this.selectionStart = this.selectionEnd = start + 2;
  }
}

/**
 * Load sample code based on language
 */
function loadSampleCode() {
  if (!codeInput || !codeLanguage) return;
  
  const samples = {
    javascript: `// JavaScript sample
function greet(name) {
  return "Hello, " + name + "!";
}

// Test the function
const result = greet("CephasGM AI");
console.log(result);

// Calculate fibonacci
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log("Fibonacci(10) =", fibonacci(10));`,
    
    python: `# Python sample
def greet(name):
    return f"Hello, {name}!"

# Test the function
result = greet("CephasGM AI")
print(result)

# Calculate fibonacci
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(f"Fibonacci(10) = {fibonacci(10)}")`,
    
    html: `<!DOCTYPE html>
<html>
<head>
    <title>CephasGM AI Sample</title>
    <style>
        body { font-family: Arial; padding: 20px; }
        h1 { color: #ffb300; }
    </style>
</head>
<body>
    <h1>Hello from CephasGM AI!</h1>
    <p>This is a sample HTML page.</p>
    <script>
        console.log("JavaScript running inside HTML");
    </script>
</body>
</html>`
  };
  
  const selectedLang = codeLanguage.value;
  if (samples[selectedLang]) {
    codeInput.value = samples[selectedLang];
  }
}

/**
 * Clear code input
 */
function clearCode() {
  if (codeInput) {
    codeInput.value = '';
  }
  if (codeOutput) {
    codeOutput.innerHTML = '';
  }
}

/**
 * Copy code to clipboard
 */
function copyCode() {
  if (!codeInput) return;
  
  codeInput.select();
  document.execCommand('copy');
  
  // Show feedback
  const btn = document.getElementById('copyCodeBtn');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
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
window.runCode = runCode;
window.clearCode = clearCode;
window.copyCode = copyCode;
window.loadSampleCode = loadSampleCode;
