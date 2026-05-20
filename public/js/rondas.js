document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    const categoriaURL = (cat) =>
        `https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_${cat}.json`;

    const categoriaParam = params.get("categoria");
    const categoriaBtns = document.querySelectorAll(".categoria-btn");
    const infoCategoria = document.getElementById("info-categoria");
    const partidas = document.getElementById("partidas");
    const tablaPosiciones = document.getElementById("tabla-posiciones");

    if (categoriaParam) {
        cargarDatosCategoria(categoriaParam);
        console.log(categoriaParam);
        const button = document.querySelector(`.categoria-btn[data-categoria="${categoriaParam}"]`);
        if (button) button.classList.add("active");
        infoCategoria.style.display = "block";
    }

    categoriaBtns.forEach(button => {
        button.addEventListener("click", () => {
            const cat = button.getAttribute("data-categoria");
            categoriaBtns.forEach(b => b.classList.remove("active"));
            button.classList.add("active");
            cargarDatosCategoria(cat);
            infoCategoria.style.display = "block";
        });
    });

    function cargarDatosCategoria(categoria) {
        fetch(categoriaURL(categoria))
            .then(res => res.json())
            .then(data => {
                mostrarPartidas(data);
                mostrarTablaPosiciones(data);
            })
            .catch(err => console.error("Error al cargar los datos:", err));
    }

    function mostrarPartidas(data) {
        partidas.innerHTML = ""; // Limpiar contenido anterior
    
        // Validación: si no hay jornadas o participantes, mostrar mensaje
        if (!data || !data.jornadas || data.jornadas.length === 0 || !data.participantes) {
            partidas.innerHTML = `<p>No hay rondas disponibles para esta categoría.</p>`;
            return;
        }
    
        const nombreCategoria = data.categoria ? data.categoria.toUpperCase() : "sin nombre";
        partidas.innerHTML = `<h3>Partidas de Categoría ${nombreCategoria}</h3>`;
    
        const participantes = data.participantes.reduce((acc, p) => {
            acc[p.id] = p.nombre;
            return acc;
        }, {});
    
        data.jornadas.forEach(jornada => {
            const roundTitle = document.createElement("h4");
            roundTitle.textContent = `Ronda ${jornada.ronda}`;
            partidas.appendChild(roundTitle);
    
            const roundContainer = document.createElement("div");
            roundContainer.classList.add("round-container");
    
            jornada.partidos?.forEach(partido => {
                const nombre1 = participantes[partido.jugador1Id] || "Jugador 1";
                const nombre2 = participantes[partido.jugador2Id] || "Jugador 2";
    
                let score1 = "", score2 = "";
                if (partido.resultado) {
                    score1 = partido.resultado[partido.jugador1Id] ?? "";
                    score2 = partido.resultado[partido.jugador2Id] ?? "";
                }
    
                let draftHTML = "";
                if (partido.resultado?.draftmapas || partido.resultado?.draftcivis) {
                    draftHTML += `<div class="draft-links">`;
                    if (partido.resultado.draftmapas) {
                        draftHTML += `<a href="${partido.resultado.draftmapas}" target="_blank">📍 Draft Mapas</a> `;
                    }
                    if (partido.resultado.draftcivis) {
                        draftHTML += `<a href="${partido.resultado.draftcivis}" target="_blank">🛡️ Draft Civis</a>`;
                    }
                    draftHTML += `</div>`;
                }
    
                const matchBox = document.createElement("div");
                matchBox.classList.add("match-box");
                matchBox.innerHTML = `
                    <div class="player">${nombre1} <span class="score">${score1}</span></div>
                    <div class="player">${nombre2} <span class="score">${score2}</span></div>
                    ${draftHTML}
                `;
                roundContainer.appendChild(matchBox);
            });
    
            partidas.appendChild(roundContainer);
        });
    }
    

function mostrarTablaPosiciones(data) {
    tablaPosiciones.innerHTML = "<h3>Tabla de Posiciones</h3>";

    // Si hay grupos definidos, mostramos una tabla por grupo
    if (data.grupos) {
        Object.entries(data.grupos).forEach(([grupoNombre, jugadoresGrupo]) => {
            const idsGrupo = jugadoresGrupo.map(j => j.id);

            // Inicializamos datos por jugador del grupo
            const puntos = {};
            idsGrupo.forEach(id => {
                const jugador = data.participantes.find(p => p.id === id);
                puntos[id] = {
                    nombre: jugador ? jugador.nombre : "Desconocido",
                    puntos: 0,
                    jugadas: 0,
                    ganadas: 0
                };
            });

            // Recorremos las jornadas y sumamos puntos SOLO si ambos jugadores están en el grupo
            data.jornadas.forEach(jornada => {
                jornada.partidos.forEach(p => {
                    if (!p.resultado) return;

                    const id1 = p.jugador1Id;
                    const id2 = p.jugador2Id;
                    if (!idsGrupo.includes(id1) || !idsGrupo.includes(id2)) return; // Saltar partidos entre grupos

                    const s1 = p.resultado[id1] ?? 0;
                    const s2 = p.resultado[id2] ?? 0;

                    puntos[id1].puntos += s1;
                    puntos[id2].puntos += s2;
                    puntos[id1].jugadas += 1;
                    puntos[id2].jugadas += 1;

                    if (s1 > s2) puntos[id1].ganadas += 1;
                    else if (s2 > s1) puntos[id2].ganadas += 1;
                });
            });

            const lista = Object.values(puntos).sort((a, b) => b.puntos - a.puntos);

            const titulo = document.createElement("h4");
            titulo.textContent = `Grupo ${grupoNombre}`;
            tablaPosiciones.appendChild(titulo);

            const tabla = document.createElement("table");
            tabla.classList.add("tabla-posiciones");
            tabla.innerHTML = `
                <tr><th>Pos</th><th>Jugador</th><th>Puntos</th><th>Jugadas</th><th>Ganadas</th></tr>
                ${lista.map((p, i) => `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${p.nombre}</td>
                        <td>${p.puntos}</td>
                        <td>${p.jugadas}</td>
                        <td>${p.ganadas}</td>
                    </tr>
                `).join("")}
            `;
            tablaPosiciones.appendChild(tabla);
        });
    } else {
        // Modo clásico (todos contra todos)
        const puntos = {};

        data.participantes.forEach(p => {
            puntos[p.id] = {
                nombre: p.nombre,
                puntos: 0,
                jugadas: 0,
                ganadas: 0
            };
        });

        data.jornadas.forEach(j => {
            j.partidos.forEach(p => {
                if (!p.resultado) return;

                const id1 = p.jugador1Id;
                const id2 = p.jugador2Id;
                const s1 = p.resultado[id1] ?? 0;
                const s2 = p.resultado[id2] ?? 0;

                puntos[id1].puntos += s1;
                puntos[id2].puntos += s2;
                puntos[id1].jugadas += 1;
                puntos[id2].jugadas += 1;

                if (s1 > s2) puntos[id1].ganadas += 1;
                else if (s2 > s1) puntos[id2].ganadas += 1;
            });
        });

        const lista = Object.values(puntos).sort((a, b) => b.puntos - a.puntos);

        const tabla = document.createElement("table");
        tabla.classList.add("tabla-posiciones");
        tabla.innerHTML = `
            <tr><th>Posición</th><th>Jugador</th><th>Puntos</th><th>Jugadas</th><th>Ganadas</th></tr>
            ${lista.map((p, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td>${p.nombre}</td>
                    <td>${p.puntos}</td>
                    <td>${p.jugadas}</td>
                    <td>${p.ganadas}</td>
                </tr>
            `).join("")}
        `;

        tablaPosiciones.appendChild(tabla);
    }
}
});
