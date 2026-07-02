const Database = require('better-sqlite3');
const path = require('path');

// Un partido individual bloquea la votación salvo que tenga un override explícito.
// votacion_forzada: 1 = forzar abierto, 0 = forzar cerrado, null = automático (por coordinado/finalizado)
function esBloqueado(p) {
  if (p.votacion_forzada === 1) return false;
  if (p.votacion_forzada === 0) return true;
  return p.estado === 'finalizado' || (p.coordinado && new Date(p.coordinado) <= new Date());
}

// Penca de un torneo entero: cerrada si el admin la forzó, o si algún override individual
// la reabre, o si (modo automático) algún partido activo ya arrancó.
function calcularCerrada(torneo, partidos) {
  if (torneo.penca_abierta === 0) return true;
  if (torneo.penca_abierta === 1) return false;
  if (partidos.some(p => p.votacion_forzada === 1)) return false;
  const activos = partidos.filter(p => p.estado !== 'finalizado');
  if (activos.length === 0) return true;
  const ahora = new Date();
  return activos.some(p => p.coordinado && new Date(p.coordinado) <= ahora);
}

// El campeón se bloquea cuando arranca el primer partido del torneo, para siempre,
// salvo override explícito en el torneo (campeon_override: 1 abre, 0 cierra, null automático).
function calcularCampeonBloqueado(partidos, torneo) {
  if (torneo && torneo.campeon_override === 1) return false;
  if (torneo && torneo.campeon_override === 0) return true;
  const ahora = new Date();
  return partidos.some(p =>
    p.estado === 'finalizado' ||
    (p.coordinado && new Date(p.coordinado) <= ahora)
  );
}

function actualizarPuntosPenca(partidoId, realS1, realS2) {
  const db = new Database(path.resolve(__dirname, '../botfmg.db'));
  try {
    const partido = db.prepare('SELECT cuenta_penca FROM partidos WHERE id = ?').get(partidoId);

    if (!partido || partido.cuenta_penca === 0) {
      db.prepare('UPDATE penca_votos SET puntos_obtenidos = 0 WHERE partido_id = ?').run(partidoId);
      return;
    }

    const apuestas = db.prepare('SELECT * FROM penca_votos WHERE partido_id = ?').all(partidoId);
    const stmtActualizar = db.prepare('UPDATE penca_votos SET puntos_obtenidos = ? WHERE id = ?');

    db.transaction((votos) => {
      for (const voto of votos) {
        let puntos = 0;
        if (voto.prediccion_score1 === realS1 && voto.prediccion_score2 === realS2) {
          puntos = 3;
        } else if (Math.sign(voto.prediccion_score1 - voto.prediccion_score2) === Math.sign(realS1 - realS2)) {
          puntos = 1;
        }
        stmtActualizar.run(puntos, voto.id);
      }
    })(apuestas);
  } finally {
    db.close();
  }
}

module.exports = { actualizarPuntosPenca, esBloqueado, calcularCerrada, calcularCampeonBloqueado };
