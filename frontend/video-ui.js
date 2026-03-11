// video-ui.js
async function generateVideo(prompt){
  const res = await fetch("/video",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({prompt})
  });
  const data = await res.json();
  displayVideo(data.url);
}

function displayVideo(url){
  const container = document.getElementById("video-result");
  container.innerHTML = `<video controls src="${url}" width="400"></video>`;
}
