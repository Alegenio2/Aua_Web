const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { obtenerEloActual } = require('../lib/aoe2');
const { esBloqueado, calcularCerrada, calcularCampeonBloqueado } = require('../lib/penca');

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
        SELECT u.nombre, u.clan, u.pais, i.usuario_id, i.elo_inscripcion, i.equipo_id, i.fecha_inscripcion, i.pago
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
    const torneosActivos = db.prepare("SELECT * FROM torneos WHERE estado = 'jugando' ORDER BY creado_en DESC").all();

    if (torneosActivos.length === 0) {
      return res.render('admin-penca', {
        user: req.user,
        torneosConPartidos: [],
        flash: null,
        error: null,
      });
    }

    const torneosConPartidos = torneosActivos.map(torneo => {
      const partidos = db.prepare(`
        SELECT p.*,
               u1.nombre as j1, u2.nombre as j2,
               e1.nombre as eq1, e2.nombre as eq2
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        WHERE p.torneo_id = ?
        ORDER BY CASE WHEN p.estado = 'finalizado' THEN 1 ELSE 0 END, p.id
      `).all(torneo.id).map(p => ({ ...p, j1: p.eq1 || p.j1, j2: p.eq2 || p.j2, bloqueado: esBloqueado(p) }));
      const todosPartidos = db.prepare('SELECT estado, coordinado, votacion_forzada FROM partidos WHERE torneo_id = ?').all(torneo.id);
      let estadoPenca;
      if (torneo.penca_abierta === 0) {
        estadoPenca = 'cerrada_admin';
      } else if (torneo.penca_abierta === 1) {
        estadoPenca = 'abierta_admin';
      } else {
        estadoPenca = calcularCerrada(torneo, todosPartidos) ? 'cerrada_auto' : 'abierta_auto';
      }
      const campeonBloqueado = calcularCampeonBloqueado(todosPartidos, torneo);
      // Participantes para el selector de campeón (equipos o jugadores)
      const esEquipo = torneo.tipo !== '1v1';
      const participantes = esEquipo
        ? db.prepare(`
            SELECT CAST(e.id AS TEXT) AS id, e.nombre
            FROM equipos e WHERE e.torneo_id = ? ORDER BY e.nombre
          `).all(torneo.id)
        : db.prepare(`
            SELECT u.discordId AS id, u.nombre
            FROM usuarios u
            JOIN inscripciones i ON u.discordId = i.usuario_id
            WHERE i.torneo_id = ? ORDER BY u.nombre
          `).all(torneo.id);

      return { ...torneo, partidos, estadoPenca, campeonBloqueado, participantes, esEquipo };
    });

    res.render('admin-penca', {
      user: req.user,
      torneosConPartidos,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

// POST /admin/penca/definir-campeon
router.post('/penca/definir-campeon', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneo_id, campeon_id, puntos_bonus } = req.body;
    if (!torneo_id || !campeon_id) {
      return res.redirect('/admin/penca?err=' + encodeURIComponent('Datos incompletos.'));
    }

    const bonus = parseInt(puntos_bonus) || 5;

    db.transaction(() => {
      // Guardar el campeón real en el torneo
      db.prepare('UPDATE torneos SET campeon_id = ? WHERE id = ?').run(campeon_id, torneo_id);

      // Resetear puntos anteriores (por si se redefine el campeón)
      db.prepare('UPDATE penca_campeon SET puntos_campeon = 0 WHERE torneo_id = ?').run(torneo_id);

      // Otorgar bonus a los que acertaron
      db.prepare(`
        UPDATE penca_campeon SET puntos_campeon = ?
        WHERE torneo_id = ? AND campeon_id = ?
      `).run(bonus, torneo_id, campeon_id);
    })();

    res.redirect('/admin/penca?msg=' + encodeURIComponent('Campeón definido y puntos otorgados.'));
  } catch (e) {
    console.error('Error definir campeón:', e);
    res.redirect('/admin/penca?err=' + encodeURIComponent('Error al definir el campeón.'));
  } finally {
    db.close();
  }
});

// POST /admin/penca/toggle
router.post('/penca/toggle', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneo_id, accion } = req.body;
    if (!torneo_id || !['abrir', 'cerrar', 'auto'].includes(accion)) {
      return res.redirect('/admin/penca?err=' + encodeURIComponent('Datos inválidos.'));
    }
    const valor = accion === 'abrir' ? 1 : accion === 'cerrar' ? 0 : null;
    db.prepare('UPDATE torneos SET penca_abierta = ? WHERE id = ?').run(valor, torneo_id);
    const msg = accion === 'abrir' ? 'Penca abierta manualmente.' : accion === 'cerrar' ? 'Penca cerrada manualmente.' : 'Penca volvió a modo automático.';
    res.redirect('/admin/penca?msg=' + encodeURIComponent(msg));
  } catch (e) {
    console.error('Error toggle penca:', e);
    res.redirect('/admin/penca?err=' + encodeURIComponent('Error al cambiar estado de la penca.'));
  } finally {
    db.close();
  }
});

// POST /admin/penca/partido-toggle — override individual de votación por partido
router.post('/penca/partido-toggle', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { partido_id, accion } = req.body;
    if (!partido_id || !['abrir', 'cerrar', 'auto'].includes(accion)) {
      return res.redirect('/admin/penca?err=' + encodeURIComponent('Datos inválidos.'));
    }
    const valor = accion === 'abrir' ? 1 : accion === 'cerrar' ? 0 : null;
    db.prepare('UPDATE partidos SET votacion_forzada = ? WHERE id = ?').run(valor, partido_id);
    const msg = accion === 'abrir' ? 'Votación del partido reabierta.' : accion === 'cerrar' ? 'Votación del partido cerrada.' : 'Votación del partido volvió a automático.';
    res.redirect('/admin/penca?msg=' + encodeURIComponent(msg));
  } catch (e) {
    console.error('Error toggle partido penca:', e);
    res.redirect('/admin/penca?err=' + encodeURIComponent('Error al cambiar la votación del partido.'));
  } finally {
    db.close();
  }
});

// POST /admin/penca/campeon-toggle — override de votación de campeón por torneo
router.post('/penca/campeon-toggle', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneo_id, accion } = req.body;
    if (!torneo_id || !['abrir', 'cerrar', 'auto'].includes(accion)) {
      return res.redirect('/admin/penca?err=' + encodeURIComponent('Datos inválidos.'));
    }
    const valor = accion === 'abrir' ? 1 : accion === 'cerrar' ? 0 : null;
    db.prepare('UPDATE torneos SET campeon_override = ? WHERE id = ?').run(valor, torneo_id);
    const msg = accion === 'abrir' ? 'Votación de campeón reabierta.' : accion === 'cerrar' ? 'Votación de campeón cerrada.' : 'Votación de campeón volvió a automático.';
    res.redirect('/admin/penca?msg=' + encodeURIComponent(msg));
  } catch (e) {
    console.error('Error toggle campeón penca:', e);
    res.redirect('/admin/penca?err=' + encodeURIComponent('Error al cambiar la votación de campeón.'));
  } finally {
    db.close();
  }
});

router.get('/partidos', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneosActivos = db.prepare("SELECT id, nombre FROM torneos WHERE estado = 'jugando' ORDER BY creado_en DESC").all();

    if (torneosActivos.length === 0) {
      return res.render('admin-partidos', {
        user: req.user,
        torneosConPartidos: [],
        flash: null,
        error: null,
      });
    }

    const torneosConPartidos = torneosActivos.map(torneo => {
      const partidos = db.prepare(`
        SELECT p.id, p.ronda, p.fase, p.jugador1_id, p.jugador2_id,
               p.equipo1_id, p.equipo2_id, p.cuenta_penca,
               u1.nombre as j1, u2.nombre as j2,
               e1.nombre as eq1, e1.elo1 as eq1_elo1, e1.elo2 as eq1_elo2,
               e2.nombre as eq2, e2.elo1 as eq2_elo1, e2.elo2 as eq2_elo2,
               ej11.nombre as eq1_j1_nombre, ej12.nombre as eq1_j2_nombre,
               ej21.nombre as eq2_j1_nombre, ej22.nombre as eq2_j2_nombre
        FROM partidos p
        LEFT JOIN usuarios u1   ON p.jugador1_id  = u1.discordId
        LEFT JOIN usuarios u2   ON p.jugador2_id  = u2.discordId
        LEFT JOIN equipos  e1   ON p.equipo1_id   = e1.id
        LEFT JOIN equipos  e2   ON p.equipo2_id   = e2.id
        LEFT JOIN usuarios ej11 ON e1.jugador1_id = ej11.discordId
        LEFT JOIN usuarios ej12 ON e1.jugador2_id = ej12.discordId
        LEFT JOIN usuarios ej21 ON e2.jugador1_id = ej21.discordId
        LEFT JOIN usuarios ej22 ON e2.jugador2_id = ej22.discordId
        WHERE p.torneo_id = ? AND p.estado != 'finalizado'
        ORDER BY p.fase, p.ronda, p.id
      `).all(torneo.id);

      // Calcular handicap para partidos 2v2
      const partidosConHandicap = partidos.map(p => {
        if (!p.equipo1_id || !p.equipo2_id) return { ...p, handicap: null };
        const hc = handicaps2v2(
          { elo1: p.eq1_elo1, elo2: p.eq1_elo2, j1_nombre: p.eq1_j1_nombre, j2_nombre: p.eq1_j2_nombre },
          { elo1: p.eq2_elo1, elo2: p.eq2_elo2, j1_nombre: p.eq2_j1_nombre, j2_nombre: p.eq2_j2_nombre }
        );
        return { ...p, handicap: hc };
      });

      return { ...torneo, partidos: partidosConHandicap };
    });

    res.render('admin-partidos', {
      user: req.user,
      torneosConPartidos,
      flash: req.query.msg || null,
      error: req.query.err || null,
    });
  } finally {
    db.close();
  }
});

// GET /admin/resultados
router.get('/resultados', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneos = db.prepare("SELECT id, nombre FROM torneos WHERE estado IN ('jugando', 'finalizado') ORDER BY creado_en DESC").all();

    const torneosConResultados = torneos.map(torneo => {
      const partidos = db.prepare(`
        SELECT p.id, p.ronda, p.fase, p.score1, p.score2, p.cuenta_penca, p.fecha,
               u1.nombre as j1, u2.nombre as j2,
               e1.nombre as eq1, e2.nombre as eq2
        FROM partidos p
        LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
        LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
        LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
        LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
        WHERE p.torneo_id = ? AND p.estado = 'finalizado'
        ORDER BY p.fase, p.ronda, p.id
      `).all(torneo.id);
      return { ...torneo, partidos };
    }).filter(t => t.partidos.length > 0);

    res.render('admin-resultados', {
      user: req.user,
      torneosConResultados,
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
    if (!datos || datos.error) {
      const msg = datos?.error === 'profile_not_found'
        ? 'Perfil no encontrado en AoE2 Companion.'
        : 'No se pudo obtener datos desde AoE2 Companion.';
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent(msg));
    }

    db.prepare(`
      INSERT OR REPLACE INTO usuarios
        (discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, elomax, ultimapartida, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discordId.trim(), profileId, datos.nombre,
      datos.elo ?? 0, datos.rank ?? 0, datos.wins ?? 0, datos.losses ?? 0,
      datos.pais || '', datos.country || '', datos.clan || '',
      datos.elomax ?? 0, new Date().toISOString(), JSON.stringify(datos)
    );

    const msg = datos.sin1v1
      ? `${datos.nombre} agregado correctamente (sin ranking 1v1).`
      : `${datos.nombre} agregado correctamente (ELO: ${datos.elo}).`;
    res.redirect('/admin/usuarios?msg=' + encodeURIComponent(msg));
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
    if (!datos || datos.error) {
      const msg = datos?.error === 'profile_not_found'
        ? 'Perfil no encontrado en AoE2 Companion.'
        : 'No se pudo obtener datos desde AoE2 Companion.';
      return res.redirect('/admin/usuarios?err=' + encodeURIComponent(msg));
    }

    if (datos.sin1v1) {
      db.prepare(`
        UPDATE usuarios SET nombre = ?, clan = ?, pais = ?, country = ? WHERE discordId = ?
      `).run(datos.nombre, datos.clan, datos.pais, datos.country, discordId);
      return res.redirect('/admin/usuarios?msg=' + encodeURIComponent(`${datos.nombre} actualizado (sin ranking 1v1, ELO no modificado).`));
    }

    db.prepare(`
      UPDATE usuarios SET elo = ?, rank = ?, wins = ?, losses = ?, ultimapartida = ?,
        nombre = ?, clan = ?, pais = ?, country = ?, elomax = ? WHERE discordId = ?
    `).run(datos.elo, datos.rank, datos.wins, datos.losses, datos.ultimapartida,
           datos.nombre, datos.clan, datos.pais, datos.country, datos.elomax, discordId);

    res.redirect('/admin/usuarios?msg=' + encodeURIComponent(`${datos.nombre} actualizado — ELO: ${datos.elo}.`));
  } catch (e) {
    console.error('Error actualizar ELO:', e);
    res.redirect('/admin/usuarios?err=' + encodeURIComponent('Error al actualizar datos.'));
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

// ── Equipos 2v2 ──────────────────────────────────────────────────────────────

function redondear50(elo) {
  return Math.round(elo / 50) * 50;
}

function calcularHandicap(eloJugador, maxElo) {
  return 100 + Math.floor((maxElo - eloJugador) / 150) * 5;
}

function handicaps2v2(e1, e2) {
  if (!e1 || !e2) return null;
  const maxElo = Math.max(e1.elo1, e1.elo2, e2.elo1, e2.elo2);
  return {
    maxElo,
    equipo1: [
      { nombre: e1.j1_nombre, elo: e1.elo1, pct: calcularHandicap(e1.elo1, maxElo) },
      { nombre: e1.j2_nombre, elo: e1.elo2, pct: calcularHandicap(e1.elo2, maxElo) },
    ],
    equipo2: [
      { nombre: e2.j1_nombre, elo: e2.elo1, pct: calcularHandicap(e2.elo1, maxElo) },
      { nombre: e2.j2_nombre, elo: e2.elo2, pct: calcularHandicap(e2.elo2, maxElo) },
    ],
  };
}

// GET /admin/equipos
router.get('/equipos', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const torneos = db.prepare(
      "SELECT id, nombre FROM torneos WHERE estado IN ('inscripcion','jugando') ORDER BY creado_en DESC"
    ).all();

    const equiposPorTorneo = torneos.map(t => {
      const equipos = db.prepare(`
        SELECT e.*,
               u1.nombre AS nombre1, u2.nombre AS nombre2
        FROM equipos e
        JOIN usuarios u1 ON e.jugador1_id = u1.discordId
        JOIN usuarios u2 ON e.jugador2_id = u2.discordId
        WHERE e.torneo_id = ?
        ORDER BY e.elo_promedio DESC
      `).all(t.id);
      return { ...t, equipos };
    }).filter(t => t.equipos.length > 0 || true);

    const usuarios = db.prepare(
      'SELECT discordId, nombre, elo FROM usuarios ORDER BY elo DESC'
    ).all();

    res.render('admin-equipos', {
      user: req.user,
      torneos,
      equiposPorTorneo,
      usuarios,
      flash: req.query.msg || null,
      error:  req.query.err  || null,
    });
  } finally {
    db.close();
  }
});

// POST /admin/equipos/crear
router.post('/equipos/crear', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneo_id, nombre, jugador1_id, jugador2_id } = req.body;

    if (!torneo_id || !nombre?.trim() || !jugador1_id || !jugador2_id) {
      return res.redirect('/admin/equipos?err=' + encodeURIComponent('Todos los campos son obligatorios.'));
    }
    if (jugador1_id === jugador2_id) {
      return res.redirect('/admin/equipos?err=' + encodeURIComponent('Los dos jugadores deben ser distintos.'));
    }

    const u1 = db.prepare('SELECT nombre, elo FROM usuarios WHERE discordId = ?').get(jugador1_id);
    const u2 = db.prepare('SELECT nombre, elo FROM usuarios WHERE discordId = ?').get(jugador2_id);
    if (!u1 || !u2) {
      return res.redirect('/admin/equipos?err=' + encodeURIComponent('Jugador no encontrado.'));
    }

    const torneo = db.prepare('SELECT elo_max_promedio FROM torneos WHERE id = ?').get(torneo_id);
    const elo1 = redondear50(u1.elo);
    const elo2 = redondear50(u2.elo);
    const elo_promedio = Math.round((elo1 + elo2) / 2);

    const capPromedio = torneo?.elo_max_promedio ?? null;
    if (capPromedio !== null && elo_promedio > capPromedio) {
      return res.redirect('/admin/equipos?err=' + encodeURIComponent(
        `ELO promedio ${elo_promedio} supera el tope de ${capPromedio} (${u1.nombre}: ${elo1} · ${u2.nombre}: ${elo2}).`
      ));
    }

    // Verificar que ningún jugador ya esté en otro equipo del mismo torneo
    const yaInscripto = db.prepare(`
      SELECT id FROM equipos
      WHERE torneo_id = ? AND (jugador1_id = ? OR jugador2_id = ? OR jugador1_id = ? OR jugador2_id = ?)
    `).get(torneo_id, jugador1_id, jugador1_id, jugador2_id, jugador2_id);

    if (yaInscripto) {
      return res.redirect('/admin/equipos?err=' + encodeURIComponent('Uno de los jugadores ya pertenece a un equipo en este torneo.'));
    }

    db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO equipos (torneo_id, nombre, jugador1_id, jugador2_id, elo1, elo2, elo_promedio)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(torneo_id, nombre.trim(), jugador1_id, jugador2_id, elo1, elo2, elo_promedio);

      const equipoId = res.lastInsertRowid;

      // Insertar en inscripciones para que el generador de torneo los reconozca
      const inscribir = db.prepare(`
        INSERT OR IGNORE INTO inscripciones (torneo_id, usuario_id, elo_inscripcion, equipo_id)
        VALUES (?, ?, ?, ?)
      `);
      inscribir.run(torneo_id, jugador1_id, elo1, equipoId);
      inscribir.run(torneo_id, jugador2_id, elo2, equipoId);
    })();

    res.redirect('/admin/equipos?msg=' + encodeURIComponent(`Equipo "${nombre.trim()}" creado correctamente.`));
  } catch (e) {
    console.error('Error crear equipo:', e);
    res.redirect('/admin/equipos?err=' + encodeURIComponent('Error al crear el equipo.'));
  } finally {
    db.close();
  }
});

// POST /admin/equipos/eliminar
router.post('/equipos/eliminar', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { equipo_id } = req.body;
    const equipo = db.prepare('SELECT * FROM equipos WHERE id = ?').get(equipo_id);
    if (!equipo) return res.redirect('/admin/equipos?err=' + encodeURIComponent('Equipo no encontrado.'));

    db.transaction(() => {
      db.prepare('DELETE FROM inscripciones WHERE torneo_id = ? AND equipo_id = ?')
        .run(equipo.torneo_id, equipo_id);
      db.prepare('DELETE FROM equipos WHERE id = ?').run(equipo_id);
    })();

    res.redirect('/admin/equipos?msg=' + encodeURIComponent('Equipo eliminado.'));
  } catch (e) {
    console.error('Error eliminar equipo:', e);
    res.redirect('/admin/equipos?err=' + encodeURIComponent('Error al eliminar el equipo.'));
  } finally {
    db.close();
  }
});

module.exports = router;
