async function cargarTorneo() {
  try {
    // Cargar el JSON local del torneo
    const response = await fetch('../torneos/torneo_uruguay_open_cup_2v2.json');
    const data = await response.json();

    document.getElementById('info-categoria').style.display = 'block';

    if (data.grupos && data.rondas_grupos) {
      mostrarGrupos(data);
      mostrarTablaPosiciones(data);
    }

    if (data.eliminatorias) {
      mostrarEliminatorias(data.eliminatorias);
    }

  } catch (error) {
    console.error('Error al cargar el torneo:', error);
  }
}

function mostrarGrupos(data) {
  const contenedor = document.getElementById('partidas');
  contenedor.innerHTML = '';

  const titulo = document.createElement('h2');
  titulo.textContent = 'Fase de Grupos';
  contenedor.appendChild(titulo);

  data.grupos.forEach(grupo => {
    const grupoDiv = document.createElement('div');
    grupoDiv.className = 'grupo';

    const nombreGrupo = document.createElement('h3');
    nombreGrupo.textContent = grupo.nombre;
    grupoDiv.appendChild(nombreGrupo);

    const grupoLetra = grupo.nombre.replace('Grupo ', '').trim();
    const rondas = data.rondas_grupos.find(r => r.grupo === grupoLetra);

    if (rondas && rondas.partidos) {
      rondas.partidos.forEach(ronda => {
        const rondaDiv = document.createElement('div');
        rondaDiv.className = 'ronda';

        const tituloRonda = document.createElement('h4');
        tituloRonda.textContent = `Ronda ${ronda.ronda}`;
        rondaDiv.appendChild(tituloRonda);

        ronda.partidos.forEach(partido => {
          const partidoDiv = document.createElement('div');
          partidoDiv.className = 'partido';

          const info = document.createElement('p');

          // Si tiene resultado con dos valores numéricos
          const resultadoLimpio = partido.resultado
            ? Object.entries(partido.resultado).filter(([k, v]) => typeof v === 'number')
            : [];

          if (resultadoLimpio.length === 2) {
            const [e1, s1] = resultadoLimpio[0];
            const [e2, s2] = resultadoLimpio[1];

            // Determinar ganador y perdedor
            const e1Ganador = s1 > s2;
            const e2Ganador = s2 > s1;

            // Crear spans con color
            const spanE1 = document.createElement('span');
            const spanE2 = document.createElement('span');
            const spanScore = document.createElement('span');

            spanE1.textContent = e1;
            spanE2.textContent = e2;
            spanScore.textContent = ` ${s1} 🆚 ${s2} `;

            // Colores según resultado
            spanE1.style.color = e1Ganador ? '#7CFC00' : '#ff4d4d';
            spanE2.style.color = e2Ganador ? '#7CFC00' : '#ff4d4d';
            spanScore.style.color = '#ffd60a';
            spanScore.style.fontWeight = 'bold';

            // Armar línea
            info.appendChild(spanE1);
            info.appendChild(spanScore);
            info.appendChild(spanE2);
          } else {
            // Mostrar fecha si no hay resultado
            const fecha =
              partido.fecha || partido.horario
                ? ` (${partido.diaSemana || ''} ${partido.fecha || ''} ${partido.horario || ''})`
                : '';
            info.textContent = `${partido.equipo1Nombre} 🆚 ${partido.equipo2Nombre}${fecha}`;
          }

          partidoDiv.appendChild(info);

          if (resultadoLimpio.length === 2) {
            const estado = document.createElement('small');
            estado.textContent = '✅ Finalizado';
            estado.style.color = '#9effa1';
            partidoDiv.appendChild(estado);
          }

          rondaDiv.appendChild(partidoDiv);
        });

        grupoDiv.appendChild(rondaDiv);
      });
    }

    contenedor.appendChild(grupoDiv);
  });
}



// === TABLA DE POSICIONES ===
function mostrarTablaPosiciones(data) {
  const tablaPosiciones = document.getElementById('tabla-posiciones');
  tablaPosiciones.innerHTML = '<h2>Tabla de Posiciones</h2>';

  if (!data.grupos || !data.rondas_grupos) return;

  data.grupos.forEach(grupo => {
    const nombreGrupo = grupo.nombre;
    const equipos = grupo.equipos || [];
    const puntos = {};

    // Inicializar equipos
    equipos.forEach(eq => {
      puntos[eq.nombre] = {
        nombre: eq.nombre,
        puntos: 0,
        jugadas: 0,
        ganadas: 0,
        setsFavor: 0,
        setsContra: 0
      };
    });

    // Buscar rondas del grupo (A, B, etc.)
    const grupoLetra = nombreGrupo.split(' ')[1];
    const rondas = data.rondas_grupos.find(r => r.grupo === grupoLetra);
    if (!rondas || !rondas.partidos) return;

    // Recorrer cada ronda
    rondas.partidos.forEach(ronda => {
      ronda.partidos.forEach(p => {
        if (!p.resultado) return;

        // Tomar solo los nombres con valores numéricos
        const resultadoLimpio = Object.entries(p.resultado)
          .filter(([clave, valor]) => typeof valor === 'number');

        if (resultadoLimpio.length < 2) return;

        const [e1, s1] = resultadoLimpio[0];
        const [e2, s2] = resultadoLimpio[1];

        if (!puntos[e1] || !puntos[e2]) return;

        // Actualizar jugadas y sets
        puntos[e1].jugadas += 1;
        puntos[e2].jugadas += 1;

        puntos[e1].setsFavor += s1;
        puntos[e1].setsContra += s2;
        puntos[e2].setsFavor += s2;
        puntos[e2].setsContra += s1;

        // Asignar puntos según sets
        if (s1 > s2) {
          puntos[e1].puntos += 2;
          puntos[e2].puntos += s2 === 1 ? 1 : 0;
          puntos[e1].ganadas += 1;
        } else if (s2 > s1) {
          puntos[e2].puntos += 2;
          puntos[e1].puntos += s1 === 1 ? 1 : 0;
          puntos[e2].ganadas += 1;
        }
      });
    });

    // Ordenar por puntos → ganadas → diferencia de sets
    const lista = Object.values(puntos).sort((a, b) => {
      if (b.puntos !== a.puntos) return b.puntos - a.puntos;
      if (b.ganadas !== a.ganadas) return b.ganadas - a.ganadas;
      const diffA = a.setsFavor - a.setsContra;
      const diffB = b.setsFavor - b.setsContra;
      return diffB - diffA;
    });

    // Renderizar tabla
    const titulo = document.createElement('h3');
    titulo.textContent = nombreGrupo;
    tablaPosiciones.appendChild(titulo);

    const tabla = document.createElement('table');
    tabla.classList.add('tabla-posiciones');
    tabla.innerHTML = `
      <tr>
        <th>Pos</th>
        <th>Equipo</th>
        <th>Puntos</th>
        <th>Jugadas</th>
        <th>Ganadas</th>
        <th>Sets +</th>
        <th>Sets −</th>
        <th>Dif</th>
      </tr>
      ${lista.map((p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.nombre}</td>
          <td>${p.puntos}</td>
          <td>${p.jugadas}</td>
          <td>${p.ganadas}</td>
          <td>${p.setsFavor}</td>
          <td>${p.setsContra}</td>
          <td>${p.setsFavor - p.setsContra}</td>
        </tr>
      `).join('')}
    `;

    tablaPosiciones.appendChild(tabla);
  });
}


// === ELIMINATORIAS ===
function mostrarEliminatorias(eliminatorias) {
  const contenedor = document.getElementById('tabla-posiciones');
  const titulo = document.createElement('h2');
  titulo.textContent = 'Eliminatorias';
  contenedor.appendChild(titulo);

  eliminatorias.forEach(ronda => {
    const rondaDiv = document.createElement('div');
    rondaDiv.className = 'eliminatoria';

    const rondaTitulo = document.createElement('h3');
    rondaTitulo.textContent = ronda.ronda;
    rondaDiv.appendChild(rondaTitulo);

    if (!ronda.partidos || ronda.partidos.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Próximamente se definirán los partidos.';
      rondaDiv.appendChild(p);
    } else {
      ronda.partidos.forEach(partido => {
        const partidoDiv = document.createElement('div');
        partidoDiv.className = 'match';
        partidoDiv.innerHTML = `
          <span class="equipo">${partido.equipo1Nombre}</span>
          <span class="vs">🆚</span>
          <span class="equipo">${partido.equipo2Nombre}</span>
        `;
        rondaDiv.appendChild(partidoDiv);
      });
    }

    contenedor.appendChild(rondaDiv);
  });
}

document.addEventListener('DOMContentLoaded', cargarTorneo);
