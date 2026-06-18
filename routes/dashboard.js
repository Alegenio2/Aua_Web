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
        inscripciones[t.id] = db.prepare('SELECT id, equipo_id, pago FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?')
          .get(t.id, req.user.id) || null;
      }
    }

    let misPartidos = [];
    if (usuarioInterno) {
      const uid = req.user.id;
      const rows = db.prepare(`
        SELECT
          p.id, p.fase, p.ronda, p.grupo_id, p.estado, p.score1, p.score2, p.rec_link, p.coordinado,
          p.jugador1_id, p.jugador2_id, p.equipo1_id, p.equipo2_id,
          u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
          u1.discordId AS j1_id, u2.discordId AS j2_id,
          e1.nombre AS eq1_nombre, e2.nombre AS eq2_nombre,
          e1.jugador1_id AS e1_j1_id, e1.jugador2_id AS e1_j2_id,
          e2.jugador1_id AS e2_j1_id, e2.jugador2_id AS e2_j2_id,
          g.nombre AS grupo_nombre,
          t.nombre AS torneo_nombre, t.slug AS torneo_slug
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        LEFT JOIN grupos   g  ON p.grupo_id    = g.id
        LEFT JOIN torneos  t  ON p.torneo_id   = t.id
        WHERE p.jugador1_id = ? OR p.jugador2_id = ?
           OR p.equipo1_id IN (SELECT id FROM equipos WHERE jugador1_id = ? OR jugador2_id = ?)
           OR p.equipo2_id IN (SELECT id FROM equipos WHERE jugador1_id = ? OR jugador2_id = ?)
        ORDER BY p.id DESC
      `).all(uid, uid, uid, uid, uid, uid);

      misPartidos = rows.map(p => {
        if (p.equipo1_id) {
          const enEquipo1 = p.e1_j1_id === uid || p.e1_j2_id === uid;
          const rival    = enEquipo1 ? p.eq2_nombre : p.eq1_nombre;
          const gane     = p.estado === 'finalizado' &&
            ((enEquipo1 && p.score1 > p.score2) || (!enEquipo1 && p.score2 > p.score1));
          return { ...p, rival, gane, esEquipo: true,
            j1_id: enEquipo1 ? uid : null, j2_id: enEquipo1 ? null : uid };
        }
        const esSoy1 = p.j1_id === uid;
        const rival  = esSoy1 ? p.j2_nombre : p.j1_nombre;
        const gane   = p.estado === 'finalizado' &&
          ((esSoy1 && p.score1 > p.score2) || (!esSoy1 && p.score2 > p.score1));
        return { ...p, rival, gane, esEquipo: false };
      });
    }

    const partidosPendientes = misPartidos.filter(p => p.estado !== 'finalizado');
    const partidosFinalizados = misPartidos.filter(p => p.estado === 'finalizado');

    let winrate = null;
    if (usuarioInterno && (usuarioInterno.wins + usuarioInterno.losses) > 0) {
      winrate = Math.round((usuarioInterno.wins / (usuarioInterno.wins + usuarioInterno.losses)) * 100);
    }

    // Invitaciones recibidas pendientes
    let invitacionesRecibidas = [];
    // Estado de equipo del jugador en torneos 2v2
    let equipoStatus = {};
    // Invitación enviada pendiente por torneo
    let invitacionEnviada = {};
    // Todos los jugadores para el combo de invitar
    let todosLosJugadores = [];

    if (usuarioInterno) {
      const uid = req.user.id;

      invitacionesRecibidas = db.prepare(`
        SELECT ie.id, ie.torneo_id, ie.invitador_id, ie.nombre_equipo, ie.creado_en,
               u.nombre AS invitador_nombre,
               t.nombre AS torneo_nombre
        FROM invitaciones_equipo ie
        JOIN usuarios u ON ie.invitador_id = u.discordId
        JOIN torneos  t ON ie.torneo_id  = t.id
        WHERE ie.invitado_id = ? AND ie.estado = 'pendiente'
        ORDER BY ie.id DESC
      `).all(uid);

      // Para cada torneo de equipos en inscripción, verificar si ya tiene equipo o invitación enviada
      for (const t of torneosActivos) {
        if (!['2v2', '3v3', '4v4'].includes(t.tipo)) continue;
        if (!inscripciones[t.id]) continue;

        const inscRow = db.prepare('SELECT equipo_id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(t.id, uid);
        equipoStatus[t.id] = inscRow?.equipo_id ? 'tiene_equipo' : 'sin_equipo';

        if (equipoStatus[t.id] === 'sin_equipo') {
          const pendiente = db.prepare(`
            SELECT id, invitado_id, nombre_equipo,
                   (SELECT nombre FROM usuarios WHERE discordId = ie.invitado_id) AS invitado_nombre
            FROM invitaciones_equipo ie
            WHERE torneo_id = ? AND invitador_id = ? AND estado = 'pendiente'
          `).get(t.id, uid);
          invitacionEnviada[t.id] = pendiente || null;
        }
      }

      // Lista de todos los jugadores registrados para el combo de invitar
      todosLosJugadores = db.prepare(
        'SELECT discordId, nombre, elo, clan FROM usuarios ORDER BY nombre COLLATE NOCASE'
      ).all();
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
      invitacionesRecibidas,
      equipoStatus,
      invitacionEnviada,
      todosLosJugadores,
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
    const uid = req.user.id;
    const p = db.prepare(`
      SELECT
        p.id, p.fase, p.ronda, p.estado, p.score1, p.score2, p.rec_link, p.draftmap, p.draftcivs, p.coordinado,
        p.jugador1_id, p.jugador2_id, p.equipo1_id, p.equipo2_id,
        u1.nombre AS j1_nombre, u2.nombre AS j2_nombre,
        u1.discordId AS j1_id, u2.discordId AS j2_id,
        e1.nombre AS eq1_nombre, e2.nombre AS eq2_nombre,
        e1.jugador1_id AS e1_j1_id, e1.jugador2_id AS e1_j2_id,
        e2.jugador1_id AS e2_j1_id, e2.jugador2_id AS e2_j2_id
      FROM partidos p
      LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
      LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
      WHERE p.id = ?
    `).get(req.params.id);

    if (!p) return res.redirect('/dashboard?err=' + encodeURIComponent('Partido no encontrado.'));

    // Verificar que el usuario es participante (1v1 o 2v2)
    const esParticipante =
      p.j1_id === uid || p.j2_id === uid ||
      p.e1_j1_id === uid || p.e1_j2_id === uid ||
      p.e2_j1_id === uid || p.e2_j2_id === uid;

    if (!esParticipante) {
      return res.redirect('/dashboard?err=' + encodeURIComponent('No tienes permiso para este partido.'));
    }

    // Normalizar nombres para la vista
    const partido = {
      ...p,
      j1_nombre: p.eq1_nombre || p.j1_nombre,
      j2_nombre: p.eq2_nombre || p.j2_nombre,
      j1_id: p.e1_j1_id || p.j1_id,
      j2_id: p.e2_j1_id || p.j2_id,
    };

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
