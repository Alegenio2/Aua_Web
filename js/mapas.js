document.addEventListener("DOMContentLoaded", () => {
    fetch("json/mapas.json")
      .then(response => response.json())
      .then(data => {
        const mapasContainer = document.querySelector(".contenedor-mapas");
        data.mapas.forEach(mapa => {
          const divMapa = document.createElement("div");
          divMapa.classList.add("mapa");
  
          const img = document.createElement("img");
          img.src = mapa.imagen;
          img.alt = mapa.nombre;
  
          const p = document.createElement("p");
          p.textContent = mapa.nombre;
  
          divMapa.appendChild(img);
          divMapa.appendChild(p);
  
          mapasContainer.appendChild(divMapa);
        });
      })
      .catch(error => console.error("Error al cargar los mapas:", error));
  });
  