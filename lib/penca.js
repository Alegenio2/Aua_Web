const Database = require('better-sqlite3');
const path = require('path');

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

module.exports = { actualizarPuntosPenca };
