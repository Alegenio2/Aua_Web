document.addEventListener("DOMContentLoaded", () => {
    const canales = ["fumage_", "jabsuy", "rxxon_"];
    const track = document.getElementById("twitch-carousel-track");
  
    canales.forEach(canal => {
      const iframe = document.createElement("iframe");
      iframe.src = `https://player.twitch.tv/?channel=${canal}&parent=aua.netlify.app&autoplay=false&muted=true`;
      iframe.allowFullscreen = true;
      iframe.classList.add("twitch-embed");
      track.appendChild(iframe);
    });
  
    let index = 0;
    const total = canales.length;
  
    setInterval(() => {
      index = (index + 1) % total;
      track.style.transform = `translateX(-${index * 100}%)`;
    }, 5000);
  });
  
