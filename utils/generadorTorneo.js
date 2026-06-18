const Database = require('better-sqlite3');
const path = require('path');

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function procesarGeneracionTorneo(torneoId, opciones = {}) {
  const dbPath = path.resolve(process.cwd(), 'botfmg.db');
  const db = new Database(dbPath);

  try {
    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);
    if (!torneo) return { error: 'Torneo no encontrado.' };

    const inscriptos = db.prepare(`
      SELECT u.nombre, i.usuario_id, i.elo_inscripcion, i.equipo_id
      FROM inscripciones i
      JOIN usuarios u ON i.usuario_id = u.discordId
      WHERE i.torneo_id = ?
    `).all(torneoId);

    if (!inscriptos.length) return { error: 'No hay jugadores inscriptos.' };

    const participantes = prepararParticipantes(inscriptos, torneo.tipo);
    participantes.sort((a, b) => b.elo - a.elo);

    switch (torneo.formato) {
      case 'liga':
        return generarLiga(db, torneo, participantes);
      case 'eliminacion_directa':
        return generarBracketDirecto(db, torneo, participantes);
      case 'grupos_eliminatoria':
        return generarFaseGrupos(db, torneo, participantes, opciones.ordenGrupos || 'snake_elo');
      case 'doble_eliminacion':
        return generarDobleEliminacion();
      default:
        return { error: 'Formato inválido.' };
    }
  } catch (err) {
    console.error(err);
    return { error: 'Error generando torneo.' };
  } finally {
    db.close();
  }
}

function prepararParticipantes(inscriptos, tipoTorneo) {
  if (tipoTorneo === '1v1') {
    return inscriptos.map(i => ({
      participanteId: i.usuario_id,
      nombre: i.nombre,
      elo: i.elo_inscripcion,
      tipo: 'usuario',
      miembros: []
    }));
  }

  const equiposMap = {};
  for (const i of inscriptos) {
    if (!equiposMap[i.equipo_id]) {
      equiposMap[i.equipo_id] = {
        participanteId: i.equipo_id,
        nombre: i.equipo_nombre || `Equipo ${i.equipo_id}`,
        eloTotal: 0,
        cantidad: 0,
        miembros: []
      };
    }
    equiposMap[i.equipo_id].eloTotal += i.elo_inscripcion;
    equiposMap[i.equipo_id].cantidad++;
    equiposMap[i.equipo_id].miembros.push({ usuario_id: i.usuario_id, nombre: i.nombre, elo: i.elo_inscripcion });
  }

  return Object.values(equiposMap).map(eq => ({
    participanteId: eq.participanteId,
    nombre: eq.nombre,
    elo: Math.round(eq.eloTotal / eq.cantidad),
    tipo: 'equipo',
    miembros: eq.miembros
  }));
}

function generarLiga(db, torneo, participantes) {
  const esEquipo = torneo.tipo !== '1v1';
  const insertarPartido = esEquipo
    ? db.prepare(`INSERT INTO partidos (torneo_id, fase, ronda, equipo1_id, equipo2_id, estado) VALUES (?, 'liga', ?, ?, ?, 'pendiente')`)
    : db.prepare(`INSERT INTO partidos (torneo_id, fase, ronda, jugador1_id, jugador2_id, estado) VALUES (?, 'liga', ?, ?, ?, 'pendiente')`);
  const actualizarEstado = db.prepare(`UPDATE torneos SET estado = 'jugando' WHERE id = ?`);

  db.transaction(() => {
    const lista = [...participantes];
    if (lista.length % 2 !== 0) lista.push(null);
    const n = lista.length;
    for (let fecha = 0; fecha < n - 1; fecha++) {
      for (let i = 0; i < n / 2; i++) {
        const p1 = lista[i], p2 = lista[n - 1 - i];
        if (p1 && p2) insertarPartido.run(torneo.id, fecha + 1, p1.participanteId, p2.participanteId);
      }
      rotarRoundRobin(lista);
    }
    actualizarEstado.run(torneo.id);
  })();

  return { success: true };
}

function distribuirEnGrupos(participantes, cantidadGrupos, metodo) {
  const grupos = Array.from({ length: cantidadGrupos }, () => []);

  if (metodo === 'aleatorio') {
    // Mezcla aleatoria completa, luego reparte en round-robin
    const mezclados = shuffleArray(participantes);
    mezclados.forEach((p, i) => grupos[i % cantidadGrupos].push(p));

  } else if (metodo === 'potes_elo') {
    // Potes: un pote por cada "puesto" dentro del grupo
    // Pote 1 = top N jugadores (uno por grupo), Pote 2 = siguientes N, etc.
    // Dentro de cada pote se sortea aleatoriamente quién va a cada grupo
    const tamanoPote = cantidadGrupos;
    let i = 0;
    while (i < participantes.length) {
      // Mezclar el pote para asignación aleatoria a los grupos
      const pote = shuffleArray(participantes.slice(i, i + tamanoPote));
      pote.forEach((p, j) => { if (j < cantidadGrupos) grupos[j].push(p); });
      i += tamanoPote;
    }

  } else {
    // snake_elo (por defecto): zigzag ordenado por ELO
    let direccion = 1, indice = 0;
    for (const p of participantes) {
      grupos[indice].push(p);
      indice += direccion;
      if (indice >= cantidadGrupos || indice < 0) { direccion *= -1; indice += direccion; }
    }
  }

  return grupos;
}

function generarFaseGrupos(db, torneo, participantes, ordenGrupos = 'snake_elo') {
  const cantidadGrupos = torneo.cantidad_grupos || 4;
  const grupos = distribuirEnGrupos(participantes, cantidadGrupos, ordenGrupos);
  const esEquipo = torneo.tipo !== '1v1';

  const insertarGrupo = db.prepare(`INSERT INTO grupos (torneo_id, nombre) VALUES (?, ?)`);
  const insertarGrupoParticipante = db.prepare(`INSERT INTO grupo_participantes (grupo_id, usuario_id, equipo_id, elo) VALUES (?, ?, ?, ?)`);
  const insertarPartido1v1 = db.prepare(`
    INSERT INTO partidos (torneo_id, fase, grupo_id, ronda, jugador1_id, jugador2_id, estado)
    VALUES (?, 'grupos', ?, ?, ?, ?, 'pendiente')
  `);
  const insertarPartido2v2 = db.prepare(`
    INSERT INTO partidos (torneo_id, fase, grupo_id, ronda, equipo1_id, equipo2_id, estado)
    VALUES (?, 'grupos', ?, ?, ?, ?, 'pendiente')
  `);
  const actualizarEstado = db.prepare(`UPDATE torneos SET estado = 'jugando' WHERE id = ?`);

  db.transaction(() => {
    grupos.forEach((grupo, i) => {
      const resGrupo = insertarGrupo.run(torneo.id, `Grupo ${String.fromCharCode(65 + i)}`);
      const grupoId = resGrupo.lastInsertRowid;
      grupo.forEach(p => insertarGrupoParticipante.run(
        grupoId,
        p.tipo === 'usuario' ? p.participanteId : null,
        p.tipo === 'equipo'  ? p.participanteId : null,
        p.elo
      ));

      const lista = [...grupo];
      if (lista.length % 2 !== 0) lista.push(null);
      const n = lista.length;
      for (let ronda = 0; ronda < n - 1; ronda++) {
        for (let j = 0; j < n / 2; j++) {
          const p1 = lista[j], p2 = lista[n - 1 - j];
          if (!p1 || !p2) continue;
          if (esEquipo) {
            insertarPartido2v2.run(torneo.id, grupoId, ronda + 1, p1.participanteId, p2.participanteId);
          } else {
            insertarPartido1v1.run(torneo.id, grupoId, ronda + 1, p1.participanteId, p2.participanteId);
          }
        }
        rotarRoundRobin(lista);
      }
    });
    actualizarEstado.run(torneo.id);
  })();

  return { success: true };
}

function generarBracketDirecto(db, torneo, participantes) {
  const seeds = generarSeedingBracket(participantes);
  const esEquipo = torneo.tipo !== '1v1';

  const insertarPartido = esEquipo
    ? db.prepare(`INSERT INTO partidos (torneo_id, fase, ronda, equipo1_id, equipo2_id, estado, ganador_id) VALUES (?, 'eliminatoria', ?, ?, ?, ?, ?)`)
    : db.prepare(`INSERT INTO partidos (torneo_id, fase, ronda, jugador1_id, jugador2_id, estado, ganador_id) VALUES (?, 'eliminatoria', ?, ?, ?, ?, ?)`);
  const actualizarEstado = db.prepare(`UPDATE torneos SET estado = 'jugando' WHERE id = ?`);

  db.transaction(() => {
    const totalRounds = Math.log2(seeds.length);
    let partidosRonda = seeds.length / 2;

    for (let i = 0; i < partidosRonda; i++) {
      const p1 = seeds[i * 2], p2 = seeds[i * 2 + 1];
      const estado = (!p1 || !p2) ? 'finalizado' : 'pendiente';
      const ganador = p1 && !p2 ? p1.participanteId : p2 && !p1 ? p2.participanteId : null;
      insertarPartido.run(torneo.id, 1, p1?.participanteId || null, p2?.participanteId || null, estado, ganador);
    }

    for (let ronda = 2; ronda <= totalRounds; ronda++) {
      partidosRonda /= 2;
      for (let i = 0; i < partidosRonda; i++) {
        insertarPartido.run(torneo.id, ronda, null, null, 'pendiente', null);
      }
    }

    actualizarEstado.run(torneo.id);
  })();

  // Avanzar ganadores de BYEs (partidos con un solo jugador) a la ronda 2
  const byeMatches = db.prepare(
    `SELECT id, ganador_id FROM partidos WHERE torneo_id = ? AND fase = 'eliminatoria' AND ronda = 1 AND estado = 'finalizado' AND ganador_id IS NOT NULL`
  ).all(torneo.id);

  if (byeMatches.length > 0) {
    const ronda1Ids = db.prepare(
      `SELECT id FROM partidos WHERE torneo_id = ? AND fase = 'eliminatoria' AND ronda = 1 ORDER BY id`
    ).all(torneo.id);
    const ronda2Ids = db.prepare(
      `SELECT id FROM partidos WHERE torneo_id = ? AND fase = 'eliminatoria' AND ronda = 2 ORDER BY id`
    ).all(torneo.id);

    for (const bye of byeMatches) {
      const posicion = ronda1Ids.findIndex(p => p.id === bye.id);
      if (posicion === -1) continue;
      const nextPartido = ronda2Ids[Math.floor(posicion / 2)];
      if (!nextPartido) continue;
      const esSlot1 = posicion % 2 === 0;
      if (esEquipo) {
        if (esSlot1) db.prepare('UPDATE partidos SET equipo1_id = ? WHERE id = ?').run(bye.ganador_id, nextPartido.id);
        else         db.prepare('UPDATE partidos SET equipo2_id = ? WHERE id = ?').run(bye.ganador_id, nextPartido.id);
      } else {
        if (esSlot1) db.prepare('UPDATE partidos SET jugador1_id = ? WHERE id = ?').run(bye.ganador_id, nextPartido.id);
        else         db.prepare('UPDATE partidos SET jugador2_id = ? WHERE id = ?').run(bye.ganador_id, nextPartido.id);
      }
    }
  }

  return { success: true };
}

function generarDobleEliminacion() {
  return { error: 'Doble eliminación aún no implementada.' };
}

function generarSeedingBracket(participantes) {
  const n = participantes.length;
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const lista = [...participantes];
  while (lista.length < size) lista.push(null);

  let seeds = [1, 2];
  while (seeds.length < size) {
    const nueva = [];
    const len = seeds.length * 2 + 1;
    for (const s of seeds) { nueva.push(s); nueva.push(len - s); }
    seeds = nueva;
  }

  return seeds.map(seed => lista[seed - 1] || null);
}

function rotarRoundRobin(lista) {
  const fijo = lista[0];
  const resto = lista.slice(1);
  resto.unshift(resto.pop());
  lista.splice(0, lista.length, fijo, ...resto);
}

function generarPlayoffsDesdeGrupos(db, torneoId, clasificados) {
  const participantes = [];
  for (let i = 0; i < clasificados.length; i += 2) {
    const g1 = clasificados[i], g2 = clasificados[i + 1];
    participantes.push(g1.primero, g2.segundo, g2.primero, g1.segundo);
  }
  return generarBracketDirecto(db, { id: torneoId }, participantes);
}

module.exports = { procesarGeneracionTorneo, generarPlayoffsDesdeGrupos, generarBracketDirecto };
