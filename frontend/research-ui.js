// research-ui.js
async function researchTopic(topic){
  const res = await fetch("/research",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({topic})
  });
  const data = await res.json();
  displayResearch(data.result);
}

function displayResearch(result){
  const container = document.getElementById("research-result");
  container.innerText = result;
}
