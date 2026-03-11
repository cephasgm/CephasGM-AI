// agents-ui.js
async function sendAgentTask(task){
  const res = await fetch("/task",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({task})
  });
  const data = await res.json();
  displayResult(data.result);
}

function displayResult(result){
  const container = document.getElementById("agent-result");
  container.innerText = result;
}
