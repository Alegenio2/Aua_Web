document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("torneos-globales-content");

  try {
    const res = await fetch("https://aldeanooscar.squareweb.app/api/torneos");
    if (!res.ok) throw new Error("No se pudo obtener la lista de torneos");

    const torneos = await res.json();
    
    if (!torneos || torneos.length === 0) {
      container.innerHTML = "<p>No hay torneos anunciados por ahora.</p>";
      return;
    }

    // Filtrar solo torneos futuros
    const ahora = new Date();
    const torneosFuturos = torneos.filter(torneo => new Date(torneo.start) > ahora);

    if (torneosFuturos.length === 0) {
      container.innerHTML = "<p>No hay torneos futuros anunciados.</p>";
      return;
    }

    // Función para determinar ícono según tier
    const getTierIcon = (tier) => {
      if (!tier) return "❓";
      if (tier.includes("S-Tier")) return "🟨";
      if (tier.includes("A-Tier")) return "🟩";
      if (tier.includes("B-Tier")) return "🟦";
      if (tier.includes("C-Tier")) return "🟪";
      return "❓";
    };

    // Ordenar torneos futuros por fecha de inicio
    torneosFuturos.sort((a, b) => new Date(a.start) - new Date(b.start));

    const lista = document.createElement("ul");

    torneosFuturos.slice(0, 5).forEach(torneo => {
      const startDate = new Date(torneo.start).toLocaleDateString();
      const icono = getTierIcon(torneo.tier);

      const item = document.createElement("li");
      item.innerHTML = `${icono} <strong>${torneo.name}</strong> - ${startDate}`;
      lista.appendChild(item);
    });

    container.innerHTML = ""; // Limpia el texto inicial
    container.appendChild(lista);

  } catch (error) {
    console.error("Error al cargar torneos globales:", error);
    container.innerHTML = "<p>No se pudieron cargar los torneos.</p>";
  }
});


