function getTablaPosiciones(db, grupoId) {
  const participantes = db.prepare(`
    SELECT gp.usuario_id, u.nombre, gp.elo, gp.equipo_id
    FROM grupo_participantes gp
    JOIN usuarios u ON gp.usuario_id = u.discordId
    WHERE gp.grupo_id = ?
  `).all(grupoId);

  if (participantes.length === 0) return [];

  const partidos = db.prepare(`
    SELECT p.*, u1.nombre as nombre1, u2.nombre as nombre2
    FROM partidos p
    JOIN usuarios u1 ON p.jugador1_id = u1.discordId
    JOIN usuarios u2 ON p.jugador2_id = u2.discordId
    WHERE p.grupo_id = ? AND p.estado = 'finalizado'
  `).all(grupoId);

  const stats = {};
  for (const p of participantes) {
    stats[p.usuario_id] = {
      nombre: p.nombre, elo: p.elo, equipo_id: p.equipo_id,
      pj: 0, pg: 0, pp: 0, gf: 0, gc: 0, pts: 0,
    };
  }

  for (const partido of partidos) {
    const s1 = stats[partido.jugador1_id];
    const s2 = stats[partido.jugador2_id];
    if (!s1 || !s2) continue;

    s1.pj++; s2.pj++;
    s1.gf += partido.score1 ?? 0; s1.gc += partido.score2 ?? 0;
    s2.gf += partido.score2 ?? 0; s2.gc += partido.score1 ?? 0;

    if (partido.ganador_id === partido.jugador1_id) {
      s1.pg++; s1.pts += 2; s2.pp++;
    } else if (partido.ganador_id === partido.jugador2_id) {
      s2.pg++; s2.pts += 2; s1.pp++;
    }
  }

  return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const difA = a.gf - a.gc, difB = b.gf - b.gc;
    if (difB !== difA) return difB - difA;
    return (b.elo || 0) - (a.elo || 0);
  }).map(s => ({ ...s, dif: s.gf - s.gc }));
}

module.exports = { getTablaPosiciones };
