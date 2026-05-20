document.addEventListener("DOMContentLoaded", () => {
    fetch("json/campeonatos.json")  // Ruta local al archivo JSON
        .then(response => response.json())
        .then(data => {
            const torneosContainer = document.querySelector(".torneos");
            data.campeonatos.forEach(torneo => {
                torneosContainer.innerHTML += `
                    <div class="torneo">
                        <img src="${torneo.imagen}" alt="${torneo.nombre}">
                        <h3>${torneo.nombre}</h3>
                        <p>${torneo.descripcion}</p>
                        <a href=${torneo.url} class="btn">${torneo.nombre}</a>
                    </div>
                `;
            });
        })
        .catch(error => console.error("Error al cargar los datos:", error));
});

