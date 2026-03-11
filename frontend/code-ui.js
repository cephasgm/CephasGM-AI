// code-ui.js
async function runCode(code){
  const res = await fetch("/code",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({code})
  });
  const data = await res.json();
  displayCodeOutput(data.output);
}

function displayCodeOutput(output){
  const container = document.getElementById("code-result");
  container.innerText = output;
}
