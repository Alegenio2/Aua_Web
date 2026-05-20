const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const router = express.Router();

function requireAdmin(req, res, next) {
  const admins = (process.env.ADMIN_DISCORDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!req.user || !admins.includes(req.user.id)) {
    return res.redirect('/dashboard');
  }
  next();
}

const getDB = () => new Database(path.resolve(__dirname, '../botfmg.db'));

router.get('/', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneos = db.prepare("SELECT * FROM torneos ORDER BY creado_en DESC").all();
    const torneoActivo = db.prepare("SELECT * FROM torneos WHERE estado = 'inscripcion' LIMIT 1").get();
    const torneoJugando = db.prepare("SELECT * FROM torneos WHERE estado = 'jugando' LIMIT 1").get();

    const torneosEnInscripcion = db.prepare("SELECT * FROM torneos WHERE estado = 'inscripcion' ORDER BY creado_en DESC").all();
    const torneosConInscriptos = db.prepare("SELECT * FROM torneos WHERE estado IN ('inscripcion', 'jugando') ORDER BY creado_en DESC").all();
    const inscriptosPorTorneo = {};
    for (const t of torneosConInscriptos) {
      inscriptosPorTorneo[t.id] = db.prepare(`
        SELECT u.nombre, u.clan, u.pais, i.usuario_id, i.elo_inscripcion, i.equipo_id, i.fecha_inscripcion
        FROM inscripciones i
        JOIN usuarios u ON i.usuario_id = u.discordId
        WHERE i.torneo_id = ?
        ORDER BY i.equipo_id, i.elo_inscripcion DESC
      `).all(t.id);
    }

    let partidosGenerados = 0, gruposGenerados = 0, inscriptosJugando = 0, playoffsGenerados = 0;
    let estadoPartidos = { sinCoordar: [], sinReportar: [], pendientes: [] };
    if (torneoJugando) {
      partidosGenerados = db.prepare("SELECT COUNT(*) as total FROM partidos WHERE torneo_id = ?").get(torneoJugando.id).total;
      gruposGenerados = db.prepare("SELECT COUNT(*) as total FROM grupos WHERE torneo_id = ?").get(torneoJugando.id).total;
      inscriptosJugando = db.prepare("SELECT COUNT(*) as total FROM inscripciones WHERE torneo_id = ?").get(torneoJugando.id).total;
      if (torneoJugando.formato === 'grupos_eliminatoria') {
        playoffsGenerados = db.prepare("SELECT COUNT(*) as total FROM partidos WHERE torneo_id = ? AND fase != 'grupos'").get(torneoJugando.id).total;
      }

      const pendientesRaw = db.prepare(`
        SELECT p.id, p.fase, p.ronda, p.coordinado,
               u1.nombre AS j1, u1.discordId AS j1_id,
               u2.nombre AS j2, u2.discordId AS j2_id
        FROM partidos p
        JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        WHERE p.torneo_id = ? AND p.estado != 'finalizado'
        ORDER BY p.fase, p.ronda, p.id
      `).all(torneoJugando.id);

      const ahora = new Date();
      pendientesRaw.forEach(p => {
        if (!p.coordinado) {
          estadoPartidos.sinCoordar.push(p);
        } else if (new Date(p.coordinado) < ahora) {
          estadoPartidos.sinReportar.push(p);
        } else {
          estadoPartidos.pendientes.push(p);
        }
      });
    }

    res.render('admin', {
      user: req.user,
      torneos,
      torneoActivo: torneoActivo || null,
      torneoJugando: torneoJugando || null,
      torneosEnInscripcion,
      torneosConInscriptos,
      inscriptosPorTorneo,
      partidosGenerados,
      gruposGenerados,
      inscriptosJugando,
      playoffsGenerados,
      estadoPartidos,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

router.get('/penca', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneoActivo = db.prepare("SELECT id, nombre FROM torneos WHERE estado = 'jugando' LIMIT 1").get();

    if (!torneoActivo) {
      return res.render('admin-penca', {
        user: req.user,
        torneoActivo: null,
        partidos: [],
        flash: null,
        error: null,
      });
    }

    const partidos = db.prepare(`
      SELECT p.*, u1.nombre as j1, u2.nombre as j2
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.torneo_id = ? AND p.estado != 'finalizado'
    `).all(torneoActivo.id);

    res.render('admin-penca', {
      user: req.user,
      torneoActivo,
      partidos,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

router.get('/partidos', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneoActivo = db.prepare("SELECT id, nombre FROM torneos WHERE estado = 'jugando' LIMIT 1").get();

    if (!torneoActivo) {
      return res.render('admin-partidos', {
        user: req.user,
        torneoActivo: null,
        partidos: [],
        flash: null,
        error: null,
      });
    }

    const partidos = db.prepare(`
      SELECT p.id, p.ronda, p.fase, p.jugador1_id, p.jugador2_id, p.cuenta_penca,
             u1.nombre as j1, u2.nombre as j2
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.torneo_id = ? AND p.estado != 'finalizado'
      ORDER BY p.fase, p.ronda, p.id
    `).all(torneoActivo.id);

    res.render('admin-partidos', {
      user: req.user,
      torneoActivo,
      partidos,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

module.exports = router;
