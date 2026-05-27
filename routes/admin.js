const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { obtenerEloActual } = require('../lib/aoe2');

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

    // Todos los torneos en curso con sus stats individuales
    const torneosJugando = db.prepare("SELECT * FROM torneos WHERE estado = 'jugando' ORDER BY creado_en DESC").all();
    const ahora = new Date();
    const torneosJugandoData = torneosJugando.map(t => {
      const partidosGenerados = db.prepare("SELECT COUNT(*) as total FROM partidos WHERE torneo_id = ?").get(t.id).total;
      const gruposGenerados   = db.prepare("SELECT COUNT(*) as total FROM grupos WHERE torneo_id = ?").get(t.id).total;
      const inscriptosCount   = db.prepare("SELECT COUNT(*) as total FROM inscripciones WHERE torneo_id = ?").get(t.id).total;
      const playoffsGenerados = t.formato === 'grupos_eliminatoria'
        ? db.prepare("SELECT COUNT(*) as total FROM partidos WHERE torneo_id = ? AND fase != 'grupos'").get(t.id).total
        : 0;

      const pendientesRaw = db.prepare(`
        SELECT p.id, p.fase, p.ronda, p.coordinado,
               u1.nombre AS j1, u1.discordId AS j1_id,
               u2.nombre AS j2, u2.discordId AS j2_id
        FROM partidos p
        JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        WHERE p.torneo_id = ? AND p.estado != 'finalizado'
        ORDER BY p.fase, p.ronda, p.id
      `).all(t.id);

      const estadoPartidos = { sinCoordar: [], sinReportar: [], pendientes: [] };
      pendientesRaw.forEach(p => {
        if (!p.coordinado) estadoPartidos.sinCoordar.push(p);
        else if (new Date(p.coordinado) < ahora) estadoPartidos.sinReportar.push(p);
        else estadoPartidos.pendientes.push(p);
      });

      return { ...t, partidosGenerados, gruposGenerados, inscriptosJugando: inscriptosCount, playoffsGenerados, estadoPartidos };
    });

    // Compatibilidad con referencias legacy en la vista
    const torneoJugando = torneosJugandoData[0] || null;

    res.render('admin', {
      user: req.user,
      torneos,
      torneoActivo: torneoActivo || null,
      torneoJugando,
      torneosJugandoData,
      torneosConInscriptos,
      inscriptosPorTorneo,
      // legacy (primer torneo)
      partidosGenerados: torneoJugando?.partidosGenerados || 0,
      gruposGenerados:   torneoJugando?.gruposGenerados   || 0,
      inscriptosJugando: torneoJugando?.inscriptosJugando || 0,
      playoffsGenerados: torneoJugando?.playoffsGenerados || 0,
      estadoPartidos:    torneoJugando?.estadoPartidos    || { sinCoordar: [], sinReportar: [], pendientes: [] },
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

// GET /admin/usuarios
router.get('/usuarios', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const usuarios = db.prepare(`
      SELECT discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, ultimapartida
      FROM usuarios
      ORDER BY elo DESC
    `).all();
    res.render('admin-usuarios', {
      user: req.user,
      usuarios,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

// POST /admin/usuarios/agregar
router.post('/usuarios/agregar', requireAdmin, async (req, res) => {
  const db = getDB();
  try {
    const { discordId, profileUrl } = req.body;

    if (!discordId?.trim()) {
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent('El Discord ID es requerido.'));
    }

    const profileId = profileUrl?.split('/').filter(Boolean).pop();
    if (!profileId || isNaN(profileId)) {
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent('URL de AoE2 Companion inválida. Ej: https://aoe2companion.com/profile/12345'));
    }

    const datos = await obtenerEloActual(profileId);
    if (!datos) {
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent('No se encontró el perfil en AoE2 Companion.'));
    }

    db.prepare(`
      INSERT OR REPLACE INTO usuarios
        (discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, elomax, ultimapartida, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discordId.trim(), profileId, datos.nombre,
      datos.elo || 0, datos.rank || 0, datos.wins || 0, datos.losses || 0,
      datos.pais || '', datos.country || '', datos.clan || '',
      datos.elomax || datos.elo || 0, new Date().toISOString(), JSON.stringify(datos)
    );

    res.redirect('/admin/usuarios?msg=' + encodeURIComponent(`${datos.nombre} agregado correctamente (ELO: ${datos.elo}).`));
  } catch (e) {
    console.error('Error agregar usuario:', e);
    res.redirect('/admin/usuarios?err=' + encodeURIComponent(e.message || 'Error al agregar usuario.'));
  } finally {
    db.close();
  }
});

// POST /admin/usuarios/actualizar-elo
router.post('/usuarios/actualizar-elo', requireAdmin, async (req, res) => {
  const db = getDB();
  try {
    const { discordId } = req.body;
    const usuario = db.prepare('SELECT profileId, nombre FROM usuarios WHERE discordId = ?').get(discordId);
    if (!usuario?.profileId) {
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent('El usuario no tiene profileId vinculado.'));
    }

    const datos = await obtenerEloActual(usuario.profileId);
    if (!datos) {
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent('No se pudo obtener el ELO desde AoE2 Companion.'));
    }

    db.prepare(`
      UPDATE usuarios SET elo = ?, rank = ?, wins = ?, losses = ?, ultimapartida = ?, nombre = ? WHERE discordId = ?
    `).run(datos.elo, datos.rank, datos.wins, datos.losses, datos.ultimapartida, datos.nombre, discordId);

    res.redirect('/admin/usuarios?msg=' + encodeURIComponent(`ELO de ${datos.nombre} actualizado a ${datos.elo}.`));
  } catch (e) {
    console.error('Error actualizar ELO:', e);
    res.redirect('/admin/usuarios?err=' + encodeURIComponent('Error al actualizar ELO.'));
  } finally {
    db.close();
  }
});

// POST /admin/editar-elo
router.post('/editar-elo', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneoId, userId, nuevoElo } = req.body;

    if (!torneoId || !userId || nuevoElo === undefined) {
      return res.redirect(`/admin?err=Datos incompletos`);
    }

    const elo = parseInt(nuevoElo);
    if (isNaN(elo) || elo < 0) {
      return res.redirect(`/admin?err=ELO inválido`);
    }

    // Actualizar el elo en inscripciones
    const result = db.prepare(`
      UPDATE inscripciones
      SET elo_inscripcion = ?
      WHERE torneo_id = ? AND usuario_id = ?
    `).run(elo, torneoId, userId);

    if (result.changes === 0) {
      return res.redirect(`/admin?err=Inscripción no encontrada`);
    }

    res.redirect(`/admin?msg=ELO actualizado correctamente para el jugador`);
  } catch (e) {
    console.error('Error al editar ELO:', e);
    res.redirect(`/admin?err=Error al actualizar el ELO`);
  } finally {
    db.close();
  }
});

module.exports = router;
