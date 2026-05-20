document.addEventListener("DOMContentLoaded", async () => {
  const content = document.getElementById("torneo-internacional-content");

  try {
    const res = await fetch("https://aldeanooscar.squareweb.app/api/torneos");
    if (!res.ok) throw new Error("No se pudo obtener el torneo actual");

    const torneos = await res.json(); // el endpoint devuelve un array
    console.log(torneos);

    const ahora = new Date();

    // Buscar el primer torneo en curso
    const torneo = torneos.find(t => {
      const inicio = new Date(t.start);
      const fin = new Date(t.end);
      return ahora >= inicio && ahora <= fin;
    });

    if (!torneo) {
      content.innerHTML = `<p>No hay torneos internacionales en curso.</p>`;
      return;
    }

    const options = { day: "2-digit", month: "2-digit", year: "numeric" };
    const inicio = new Date(torneo.start).toLocaleDateString("es-ES", options);
    const fin = new Date(torneo.end).toLocaleDateString("es-ES", options);

    const premio = torneo.prizePool
      ? `${torneo.prizePool.amount} ${torneo.prizePool.code}`
      : "No informado";

    const ubicacion = torneo.location?.name || "Desconocida";

    // Usamos proxy de imágenes del backend
    const imagenOriginal = torneo.league?.image || "";
    const imagenFinal = imagenOriginal
      ? `https://aldeanooscar.onrender.com/proxy-image?url=${encodeURIComponent(imagenOriginal)}`
      : "img/default-tournament.png";

    content.innerHTML = `
      <div class="torneo-internacional-box">
        <img src="${imagenFinal}"
             alt="${torneo.name}"
             class="torneo-img"
             onerror="this.src='img/default-tournament.png'" />
        <div class="torneo-datos">
          <h4>${torneo.name}</h4>
          <p><strong>Inicio:</strong> ${inicio}</p>
          <p><strong>Fin:</strong> ${fin}</p>
          <p><strong>Premio:</strong> ${premio}</p>
          <p><strong>Ubicación:</strong> ${ubicacion}</p>
        </div>
      </div>
    `;

  } catch (error) {
    console.error("Error al obtener el torneo internacional:", error);
    content.innerHTML = `<p>No hay torneos internacionales en curso.</p>`;
  }
});

