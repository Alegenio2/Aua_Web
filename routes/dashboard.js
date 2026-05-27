const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { obtenerEloActual } = require('../lib/aoe2');

const router = express.Router();

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

function refrescarEloAsync(discordId, profileId, ultimapartida) {
  const ahora = Date.now();
  const ultimaActualizacion = ultimapartida ? new Date(ultimapartida).getTime() : 0;
  if (ahora - ultimaActualizacion < REFRESH_INTERVAL_MS) return;

  obtenerEloActual(profileId).then(datos => {
    if (!datos || datos.error) return;
    const db = new Database(path.resolve(process.cwd(), 'botfmg.db'));
    try {
      db.prepare(`
        UPDATE usuarios SET elo=?, rank=?, wins=?, losses=?, elomax=CASE WHEN ? > elomax THEN ? ELSE elomax END, ultimapartida=datetime('now')
        WHERE discordId=?
      `).run(datos.elo, datos.rank, datos.wins, datos.losses, datos.elo, datos.elo, discordId);
    } finally {
      db.close();
    }
  }).catch(() => {});
}

function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/discord');
  }
  next();
}

const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const torneoParaBracket = db.prepare(`
      SELECT slug FROM torneos
      WHERE estado IN ('inscripcion', 'jugando', 'activo')
      ORDER BY id DESC LIMIT 1
    `).get();
    const slugActivo = torneoParaBracket?.slug || null;

    const usuarioInterno = db.prepare('SELECT * FROM usuarios WHERE discordId = ?').get(req.user.id) || null;

    if (usuarioInterno?.profileId) {
      refrescarEloAsync(req.user.id, usuarioInterno.profileId, usuarioInterno.ultimapartida);
    }

    const torneosActivos = db.prepare(`
      SELECT * FROM torneos
      WHERE estado IN ('inscripcion', 'jugando')
      ORDER BY creado_en DESC
    `).all();

    const torneoActivo = db.prepare("SELECT * FROM torneos WHERE estado = 'inscripcion' LIMIT 1").get() || null;

    const inscripciones = {};
    if (usuarioInterno) {
      for (const t of torneosActivos) {
        inscripciones[t.id] = !!db.prepare('SELECT id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?')
          .get(t.id, req.user.id);
      }
    }

    let misPartidos = [];
    if (usuarioInterno) {
      misPartidos = db.prepare(`
        SELECT
          p.id, p.fase, p.ronda, p.grupo_id, p.estado, p.score1, p.score2, p.rec_link, p.coordinado,
          u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
          u1.discordId AS j1_id, u2.discordId AS j2_id,
          g.nombre AS grupo_nombre
        FROM partidos p
        JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN grupos g ON p.grupo_id = g.id
        WHERE p.jugador1_id = ? OR p.jugador2_id = ?
        ORDER BY p.id DESC
      `).all(req.user.id, req.user.id);
    }

    const partidosPendientes = misPartidos.filter(p => p.estado !== 'finalizado');
    const partidosFinalizados = misPartidos.filter(p => p.estado === 'finalizado');

    let winrate = null;
    if (usuarioInterno && (usuarioInterno.wins + usuarioInterno.losses) > 0) {
      winrate = Math.round((usuarioInterno.wins / (usuarioInterno.wins + usuarioInterno.losses)) * 100);
    }

    res.render('dashboard', {
      slugActivo,
      usuarioInterno,
      torneoActivo,
      torneosActivos,
      inscripciones,
      partidosPendientes,
      partidosFinalizados,
      winrate,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

router.get('/partido/:id', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const partido = db.prepare(`
      SELECT
        p.id, p.fase, p.ronda, p.estado, p.score1, p.score2, p.rec_link, p.draftmap, p.draftcivs, p.coordinado,
        u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
        u1.discordId AS j1_id, u2.discordId AS j2_id
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.id = ?
    `).get(req.params.id);

    if (!partido) return res.redirect('/dashboard?err=' + encodeURIComponent('Partido no encontrado.'));
    if (partido.j1_id !== req.user.id && partido.j2_id !== req.user.id) {
      return res.redirect('/dashboard?err=' + encodeURIComponent('No tienes permiso para este partido.'));
    }

    res.render('partido', {
      partido,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

module.exports = router;
