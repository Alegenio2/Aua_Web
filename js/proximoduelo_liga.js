document.addEventListener("DOMContentLoaded", async function () {
    const container = document.getElementById("proximas-partidas");
    if (!container) return;

    // URLs locales (ruta relativa al archivo HTML)
    const urls = [
        // Copa Uruguaya 2026 (ruta local)
        "torneos/1v1_copa_uruguaya_2026.json",
        // Formato Liga (categorías) - estos siguen siendo remotos
        { name: "A", url: "https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_a.json" },
        { name: "B", url: "https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_b.json" },
        { name: "C", url: "https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_c.json" },
        { name: "D", url: "https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_d.json" },
        { name: "E", url: "https://raw.githubusercontent.com/Alegenio2/civs/main/ligas/liga_e.json" }
    ];

    // ── Helper: limpiar nick ──────────────────────────────────
    function cleanNick(nick) {
        return (nick || '').replace(/[|\[\]]/g, '').trim();
    }

    // ── Helper: parsear fecha Copa (DD-MM-YYYY HH:MM) ──────
    function parsearFechaCopa(fecha, horario) {
        if (!fecha || !horario) return null;
        try {
            const [d, m, y] = fecha.split('-');
            const [hh, mm] = horario.split(':');
            return new Date(y, m - 1, d, hh, mm);
        } catch (e) { 
            return null; 
        }
    }

    // ── Helper: parsear fecha formato Liga ───────────────────
    function parsearFechaLiga(p) {
        if (!p.fecha || !p.horario) return null;
        try {
            const [d, m, a] = p.fecha.split(/[-/]/);
            const horaLimpia = p.horario.replace('.', ':');
            const [hh, mm] = horaLimpia.includes(':') ? horaLimpia.split(':') : [horaLimpia, '00'];
            return new Date(a, m - 1, d, hh, mm);
        } catch (e) { return null; }
    }

    // ── Renderizar duelo (formato Copa) ──────────────────────
    function renderDueloCopa(j1, j2, grupo, fechaObj, horario, diaSemana, coordinadoPor) {
        const item = document.createElement("div");
        item.className = "match-item";
        
        // Formatear fecha
        let fechaStr = '';
        if (fechaObj && horario) {
            fechaStr = `${diaSemana} ${fechaObj.getDate()} de ${fechaObj.toLocaleString('es-UY', { month: 'short' })} · ${horario}`;
        }
        
        item.innerHTML = `
            <div class="match-header">
                <span class="match-badge">${grupo}</span>
                ${coordinadoPor ? `<span class="match-coord">Coord: ${coordinadoPor}</span>` : ''}
            </div>
            <div class="match-players">
                <span class="player">${cleanNick(j1)}</span>
                <span class="vs">vs</span>
                <span class="player">${cleanNick(j2)}</span>
            </div>
            ${fechaStr ? `
            <div class="match-date">
                <i class="far fa-calendar-alt"></i> ${fechaStr}
            </div>` : ''}
        `;
        return item;
    }

    // ── Renderizar duelo (formato Liga) ──────────────────────
    function renderDueloLiga(j1Nombre, j2Nombre, cat, fecha) {
        const item = document.createElement("div");
        item.className = "match-item";
        item.innerHTML = `
            <div class="match-header">
                <span class="match-badge">Cat ${cat}</span>
            </div>
            <div class="match-players">
                <span class="player">${j1Nombre}</span>
                <span class="vs">vs</span>
                <span class="player">${j2Nombre}</span>
            </div>
            <div class="match-date">
                <i class="far fa-clock"></i> ${fecha.toLocaleString('es-UY', { 
                    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' 
                })}
            </div>
        `;
        return item;
    }

    // ── Procesar formato Copa Uruguaya ──────────────────────
    async function processCopa() {
        try {
            const res = await fetch(urls[0]);
            if (!res.ok) {
                console.warn('No se pudo cargar Copa Uruguaya:', res.status);
                return null;
            }
            const data = await res.json();

            // Detectar formato Copa: tiene grupos y rondas_grupos
            if (!data.grupos || !data.rondas_grupos) return null;

            const todosLosPartidos = [];

            data.rondas_grupos.forEach(rg => {
                rg.partidos.forEach(ronda => {
                    ronda.partidos.forEach(partido => {
                        // Solo partidos SIN resultado PERO CON fecha coordinada
                        if (partido.resultado === null && partido.fecha && partido.horario) {
                            const fechaObj = parsearFechaCopa(partido.fecha, partido.horario);
                            if (fechaObj) {
                                todosLosPartidos.push({
                                    j1: partido.jugador1Nick,
                                    j2: partido.jugador2Nick,
                                    grupo: `Grupo ${rg.grupo}`,
                                    fecha: fechaObj,
                                    horario: partido.horario,
                                    diaSemana: partido.diaSemana || '',
                                    coordinadoPor: partido.coordinadoPor || ''
                                });
                            }
                        }
                    });
                });
            });

            // Ordenar por fecha (próximos primero)
            todosLosPartidos.sort((a, b) => a.fecha - b.fecha);
            
            // Tomar los 2 primeros
            const proximos = todosLosPartidos.slice(0, 2);

            console.log('Partidos coordinados encontrados:', todosLosPartidos.length);

            if (proximos.length === 0) return null;

            return { type: 'copa', matches: proximos };
        } catch (e) {
            console.error('Error procesando Copa:', e);
            return null;
        }
    }

    // ── Procesar formato Liga ────────────────────────────────
    async function processLiga() {
        try {
            const ligaUrls = urls.slice(1); // URLs de ligas
            const resultados = await Promise.all(
                ligaUrls.map(cat => 
                    fetch(cat.url).then(res => res.json()).catch(() => null)
                )
            );

            const ahora = new Date();
            let todosLosDuelos = [];

            resultados.forEach((data, index) => {
                if (!data || !data.jornadas) return;
                const participantes = data.participantes || [];
                
                data.jornadas.forEach(j => {
                    (j.partidos || []).forEach(partido => {
                        const fechaReal = parsearFechaLiga(partido);
                        if (fechaReal && fechaReal > ahora) {
                            todosLosDuelos.push({
                                cat: ligaUrls[index].name,
                                p: partido,
                                fecha: fechaReal,
                                parts: participantes
                            });
                        }
                    });
                });
            });

            todosLosDuelos.sort((a, b) => a.fecha - b.fecha);
            const proximos = todosLosDuelos.slice(0, 2);

            if (proximos.length === 0) return null;

            return { type: 'liga', matches: proximos };
        } catch (e) {
            console.error('Error procesando Liga:', e);
            return null;
        }
    }

    // ── Init ─────────────────────────────────────────────────
    try {
        // Intentar Copa Uruguaya primero (local)
        const copaResult = await processCopa();
        
        if (copaResult && copaResult.type === 'copa' && copaResult.matches.length > 0) {
            // Limpiar container (quitar "Cargando...")
            container.innerHTML = '';
            // Renderizar formato Copa
            copaResult.matches.forEach(match => {
                container.appendChild(renderDueloCopa(
                    match.j1, 
                    match.j2, 
                    match.grupo, 
                    match.fecha, 
                    match.horario, 
                    match.diaSemana,
                    match.coordinadoPor
                ));
            });
        } else {
            // Intentar formato Liga
            const ligaResult = await processLiga();
            
            if (ligaResult && ligaResult.type === 'liga' && ligaResult.matches.length > 0) {
                // Limpiar container (quitar "Cargando...")
                container.innerHTML = '';
                ligaResult.matches.forEach(duelo => {
                    const j1 = duelo.parts.find(p => p.id === duelo.p.jugador1Id)?.nombre || "A definir";
                    const j2 = duelo.parts.find(p => p.id === duelo.p.jugador2Id)?.nombre || "A definir";
                    container.appendChild(renderDueloLiga(j1, j2, ligaResult.matches.cat, duelo.fecha));
                });
            } else {
                // No hay partidas - dejar el "Cargando..." o mostrar vacío
                container.innerHTML = `<p class="empty-msg">No hay partidas coordinadas por ahora.</p>`;
            }
        }

    } catch (error) {
        console.error('Error general:', error);
        container.innerHTML = `<p class="empty-msg">Error al sincronizar.</p>`;
    }
});
