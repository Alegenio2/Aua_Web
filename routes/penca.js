const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }
  next();
}

const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

// GET /penca/:slug
router.get('/:slug', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const torneo = db.prepare('SELECT * FROM torneos WHERE slug = ?').get(req.params.slug);
    if (!torneo) return res.status(404).render('404', { message: 'Torneo no encontrado' });

    const partidos = db.prepare(`
      SELECT p.*, u1.nombre AS n1, u2.nombre AS n2
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.torneo_id = ?
      ORDER BY p.ronda ASC, p.id ASC
    `).all(torneo.id);

    const cerrada = partidos.some(p => p.estado === 'finalizado');

    const inscriptos = db.prepare(`
      SELECT u.discordId, u.nombre
      FROM usuarios u
      JOIN inscripciones i ON u.discordId = i.usuario_id
      WHERE i.torneo_id = ?
      ORDER BY u.nombre ASC
    `).all(torneo.id);

    const miVotoCampeon = db.prepare(
      'SELECT campeon_id FROM penca_campeon WHERE usuario_id = ? AND torneo_id = ?'
    ).get(req.user.id, torneo.id) || null;

    // Votos existentes del usuario para prellenar inputs
    const misVotos = db.prepare(
      'SELECT partido_id, prediccion_score1, prediccion_score2 FROM penca_votos WHERE usuario_id = ?'
    ).all(req.user.id);
    const votosMap = {};
    for (const v of misVotos) {
      votosMap[v.partido_id] = { s1: v.prediccion_score1, s2: v.prediccion_score2 };
    }

    const ranking = db.prepare(`
      SELECT u.nombre,
        COALESCE(SUM(pv.puntos_obtenidos), 0) AS total_puntos,
        COUNT(CASE WHEN pv.puntos_obtenidos = 3 THEN 1 END) AS plenos,
        COUNT(pv.id) AS total_apuestas
      FROM usuarios u
      JOIN penca_votos pv ON u.discordId = pv.usuario_id
      JOIN partidos p ON pv.partido_id = p.id
      WHERE p.torneo_id = ? AND p.cuenta_penca = 1
      GROUP BY u.discordId
      ORDER BY total_puntos DESC, plenos DESC
    `).all(torneo.id);

    res.render('penca', {
      torneo,
      partidos,
      cerrada,
      inscriptos,
      miVotoCampeon,
      votosMap,
      ranking,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

// POST /penca/votar
router.post('/votar', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const { torneo_id, campeon_id, ...scores } = req.body;

    if (!torneo_id) return res.redirect('/dashboard?err=' + encodeURIComponent('Torneo no especificado.'));

    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneo_id);
    if (!torneo) return res.redirect('/dashboard?err=' + encodeURIComponent('Torneo no encontrado.'));

    const partidoJugado = db.prepare(
      "SELECT id FROM partidos WHERE torneo_id = ? AND estado = 'finalizado' LIMIT 1"
    ).get(torneo_id);
    if (partidoJugado) {
      return res.redirect(`/penca/${torneo.slug}?err=` + encodeURIComponent('Las apuestas ya cerraron.'));
    }

    // Parsear scores: score1_45, score2_45 → { 45: { s1, s2 } }
    const predicciones = {};
    for (const [key, val] of Object.entries(scores)) {
      const match = key.match(/^score([12])_(\d+)$/);
      if (!match) continue;
      const [, tipo, partidoId] = match;
      if (!predicciones[partidoId]) predicciones[partidoId] = { id: partidoId, s1: 0, s2: 0 };
      predicciones[partidoId][tipo === '1' ? 's1' : 's2'] = parseInt(val) || 0;
    }

    db.transaction(() => {
      if (campeon_id) {
        db.prepare(`
          INSERT INTO penca_campeon (usuario_id, torneo_id, campeon_id)
          VALUES (?, ?, ?)
          ON CONFLICT(usuario_id, torneo_id) DO UPDATE SET campeon_id = excluded.campeon_id
        `).run(req.user.id, torneo_id, campeon_id);
      }

      const stmt = db.prepare(`
        INSERT INTO penca_votos (usuario_id, partido_id, prediccion_score1, prediccion_score2)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(usuario_id, partido_id)
        DO UPDATE SET
          prediccion_score1 = excluded.prediccion_score1,
          prediccion_score2 = excluded.prediccion_score2
      `);

      for (const p of Object.values(predicciones)) {
        stmt.run(req.user.id, p.id, p.s1, p.s2);
      }
    })();

    res.redirect(`/penca/${torneo.slug}?msg=` + encodeURIComponent('¡Predicciones guardadas!'));
  } catch (e) {
    console.error('Error votar penca:', e);
    res.redirect('/dashboard?err=' + encodeURIComponent('Error al guardar predicciones.'));
  } finally {
    db.close();
  }
});

module.exports = router;
