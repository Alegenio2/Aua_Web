const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { procesarGeneracionTorneo, generarBracketDirecto } = require('../../utils/generadorTorneo');
const { obtenerEloActual } = require('../../lib/aoe2');

const router = express.Router();

const getDB = () => new Database(path.resolve(__dirname, '../../botfmg.db'));

function requireAdmin(req, res, next) {
  const admins = (process.env.ADMIN_DISCORDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!req.user || !admins.includes(req.user.id)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

// POST /api/torneos/crear
router.post('/crear', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { nombre, tipo, formato, elo_min, elo_max, valor_handicap, cantidad_grupos, clasificados_por_grupo } = req.body;

    if (!nombre?.trim()) {
      return res.redirect('/admin?err=' + encodeURIComponent('El nombre no puede estar vacío.'));
    }
    if (nombre.trim().length > 100) {
      return res.redirect('/admin?err=' + encodeURIComponent('Nombre demasiado largo (máx. 100 caracteres).'));
    }

    const tiposValidos = ['1v1', '2v2', '3v3', '4v4'];
    const formatosValidos = ['liga', 'grupos_eliminatoria', 'eliminacion_directa', 'doble_eliminacion'];
    if (!tiposValidos.includes(tipo)) return res.redirect('/admin?err=' + encodeURIComponent('Tipo inválido.'));
    if (!formatosValidos.includes(formato)) return res.redirect('/admin?err=' + encodeURIComponent('Formato inválido.'));

    const eloMin = parseInt(elo_min) || 0;
    const eloMax = parseInt(elo_max) || 3000;
    const redondeoElo = parseInt(valor_handicap) || 0;

    if (eloMin < 0 || eloMax < 0) return res.redirect('/admin?err=' + encodeURIComponent('ELO no puede ser negativo.'));
    if (eloMin >= eloMax) return res.redirect('/admin?err=' + encodeURIComponent(`ELO mínimo (${eloMin}) debe ser menor que máximo (${eloMax}).`));
    if (eloMax > 5000) return res.redirect('/admin?err=' + encodeURIComponent('ELO máximo no puede superar 5000.'));

    const id = 'torneo-' + Date.now();
    const slug = nombre.trim().toLowerCase()
      .replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

    if (!slug) return res.redirect('/admin?err=' + encodeURIComponent('Nombre inválido — debe tener caracteres alfanuméricos.'));

    const duplicado = db.prepare('SELECT id FROM torneos WHERE slug = ?').get(slug);
    if (duplicado) return res.redirect('/admin?err=' + encodeURIComponent('Ya existe un torneo con ese nombre.'));

    let cantGrupos = null, clasificadosGrupo = null;
    if (formato !== 'liga') {
      cantGrupos = parseInt(cantidad_grupos) || 4;
      clasificadosGrupo = parseInt(clasificados_por_grupo) || 2;
    }

    db.prepare(`
      INSERT INTO torneos (id, nombre, slug, tipo, formato, elo_min, elo_max, redondeo_elo, estado, creado_en, cantidad_grupos, clasificados_por_grupo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inscripcion', datetime('now'), ?, ?)
    `).run(id, nombre.trim(), slug, tipo, formato, eloMin, eloMax, redondeoElo, cantGrupos, clasificadosGrupo);

    const chTorneos = process.env.DISCORD_TORNEOS_CHANNEL;
    if (chTorneos && req.app.locals.notifyDiscord) {
      const embed = new EmbedBuilder()
        .setTitle('🏆 ¡Nuevo torneo abierto!')
        .setColor('#c8a840')
        .setDescription(`**${nombre.trim()}** ya está disponible para inscripción.`)
        .addFields(
          { name: 'Tipo', value: tipo, inline: true },
          { name: 'Formato', value: formato.replace(/_/g, ' '), inline: true },
          { name: 'ELO', value: `${eloMin} – ${eloMax}`, inline: true }
        )
        .setTimestamp();
      req.app.locals.notifyDiscord(chTorneos, { embeds: [embed] });
    }

    res.redirect('/admin?msg=' + encodeURIComponent('Torneo creado correctamente.'));
  } catch (e) {
    console.error('Error crearTorneo:', e);
    res.redirect('/admin?err=' + encodeURIComponent(e.message || 'Error al crear torneo.'));
  } finally {
    db.close();
  }
});

// POST /api/torneos/estado
router.post('/estado', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { id, nuevoEstado } = req.body;
    if (!id || !nuevoEstado) return res.redirect('/admin?err=Datos incompletos.');

    const allowedStates = ['inscripcion', 'jugando', 'finalizado', 'cancelado'];
    if (!allowedStates.includes(nuevoEstado)) return res.redirect('/admin?err=Estado inválido.');

    const torneo = db.prepare('SELECT id, estado FROM torneos WHERE id = ?').get(id);
    if (!torneo) return res.redirect('/admin?err=Torneo no encontrado.');

    const transiciones = {
      inscripcion: ['jugando', 'cancelado'],
      jugando: ['finalizado', 'cancelado'],
      finalizado: ['cancelado'],
      cancelado: []
    };

    if (!transiciones[torneo.estado]?.includes(nuevoEstado)) {
      return res.redirect('/admin?err=' + encodeURIComponent(`No puedes cambiar de "${torneo.estado}" a "${nuevoEstado}".`));
    }

    db.prepare('UPDATE torneos SET estado = ? WHERE id = ?').run(nuevoEstado, id);
    res.redirect('/admin?msg=Estado actualizado.');
  } catch (e) {
    console.error('Error cambiarEstado:', e);
    res.redirect('/admin?err=' + encodeURIComponent('Error al cambiar estado.'));
  } finally {
    db.close();
  }
});

// POST /api/torneos/generar
router.post('/generar', requireAdmin, async (req, res) => {
  const db = getDB();
  try {
    const { torneoId } = req.body;

    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);
    if (!torneo) { db.close(); return res.redirect('/admin?err=Torneo no encontrado.'); }
    if (!['inscripcion', 'jugando'].includes(torneo.estado)) {
      db.close();
      return res.redirect('/admin?err=El torneo debe estar en inscripción o en curso.');
    }

    const existentes = db.prepare('SELECT COUNT(*) as total FROM partidos WHERE torneo_id = ?').get(torneoId);
    if (existentes.total > 0) { db.close(); return res.redirect('/admin?err=El torneo ya fue generado.'); }

    const inscriptos = db.prepare('SELECT COUNT(*) as total FROM inscripciones WHERE torneo_id = ?').get(torneoId);
    if (inscriptos.total < 2) { db.close(); return res.redirect('/admin?err=Se necesitan al menos 2 inscriptos.'); }

    db.close();

    const resultado = await procesarGeneracionTorneo(torneoId);
    if (resultado && resultado.error) return res.redirect('/admin?err=' + encodeURIComponent(resultado.error));

    res.redirect('/admin?msg=Torneo generado correctamente.');
  } catch (e) {
    console.error('Error generarTorneo:', e);
    try { db.close(); } catch {}
    res.redirect('/admin?err=' + encodeURIComponent(e.message || 'Error al generar torneo.'));
  }
});

// POST /api/torneos/inscribir
router.post('/inscribir', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const { torneoId, equipo_id } = req.body;
    const discordId = req.user.id;

    const usuario = db.prepare('SELECT elo, nombre, profileId FROM usuarios WHERE discordId = ?').get(discordId);
    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);

    if (!usuario) return res.json({ success: false, error: 'Debes vincular tu perfil AoE2 primero.' });
    if (!torneo) return res.json({ success: false, error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'inscripcion') return res.json({ success: false, error: 'El torneo no está en fase de inscripción.' });

    // Actualizar ELO desde aoe2companion antes de inscribir
    if (usuario.profileId) {
      const fresco = await obtenerEloActual(usuario.profileId).catch(() => null);
      if (fresco && !fresco.error) {
        db.prepare(`
          UPDATE usuarios SET elo = ?, rank = ?, wins = ?, losses = ?, ultimapartida = ? WHERE discordId = ?
        `).run(fresco.elo, fresco.rank, fresco.wins, fresco.losses, fresco.ultimapartida, discordId);
        usuario.elo = fresco.elo;
      }
    }

    const eloUsuario = usuario.elo || 0;
    if (eloUsuario < torneo.elo_min || eloUsuario > torneo.elo_max) {
      return res.json({ success: false, error: `Tu ELO (${eloUsuario}) no pertenece a esta categoría (${torneo.elo_min}–${torneo.elo_max}).` });
    }

    let eloInscripcion = eloUsuario;
    if (torneo.redondeo_elo > 0) {
      eloInscripcion = Math.round(eloUsuario / torneo.redondeo_elo) * torneo.redondeo_elo;
    }

    db.prepare('INSERT INTO inscripciones (torneo_id, usuario_id, elo_inscripcion, equipo_id) VALUES (?, ?, ?, ?)')
      .run(torneoId, discordId, eloInscripcion, equipo_id || null);

    const channelId = process.env.DISCORD_INSCRIPCIONES_CHANNEL || '1473060055396913192';
    if (channelId && req.app.locals.notifyDiscord) {
      const nombreAoe = usuario.nombre || 'Desconocido';
      const nombreDiscord = req.user.global_name || req.user.username || req.user.displayName || discordId;
      const embed = new EmbedBuilder()
        .setTitle('🎮 Nuevo jugador inscripto')
        .setColor('#22c55e')
        .setDescription(`**${nombreAoe}** se inscribió en **${torneo.nombre}**.`)
        .addFields(
          { name: 'Torneo', value: torneo.nombre, inline: true },
          { name: 'ELO inscripción', value: `${eloInscripcion}`, inline: true },
          { name: 'Nombre AoE2', value: nombreAoe, inline: true },
          { name: 'Discord', value: `${nombreDiscord} (<@${discordId}>)`, inline: false }
        )
        .setTimestamp();

      req.app.locals.notifyDiscord(channelId, { embeds: [embed] });
    }

    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ success: false, error: 'Ya estás inscripto en este torneo.' });
    console.error('Error inscribir:', e);
    res.json({ success: false, error: e.message });
  } finally {
    db.close();
  }
});

// POST /api/torneos/generar-playoffs
router.post('/generar-playoffs', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneoId } = req.body;
    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);
    if (!torneo) return res.redirect('/admin?err=Torneo no encontrado.');
    if (torneo.formato !== 'grupos_eliminatoria') return res.redirect('/admin?err=El torneo no tiene formato Grupos+Eliminatoria.');

    const yaExisten = db.prepare("SELECT COUNT(*) AS total FROM partidos WHERE torneo_id = ? AND fase != 'grupos'").get(torneoId).total;
    if (yaExisten > 0) return res.redirect('/admin?err=Los playoffs ya fueron generados.');

    const pendientes = db.prepare("SELECT COUNT(*) AS total FROM partidos WHERE torneo_id = ? AND fase = 'grupos' AND estado != 'finalizado'").get(torneoId).total;
    if (pendientes > 0) return res.redirect('/admin?err=' + encodeURIComponent(`Faltan ${pendientes} partido(s) de grupos por finalizar.`));

    const clasificadosPorGrupo = torneo.clasificados_por_grupo || 2;
    const grupos = db.prepare('SELECT * FROM grupos WHERE torneo_id = ? ORDER BY nombre').all(torneoId);
    if (!grupos.length) return res.redirect('/admin?err=No hay grupos generados.');

    const allClasificados = [];
    grupos.forEach(g => {
      const jugadores = db.prepare('SELECT gp.usuario_id, gp.elo FROM grupo_participantes gp WHERE gp.grupo_id = ?').all(g.id);
      const partidos = db.prepare("SELECT * FROM partidos WHERE grupo_id = ? AND fase = 'grupos' AND estado = 'finalizado'").all(g.id);

      const stats = {};
      jugadores.forEach(j => { stats[j.usuario_id] = { pts: 0, sf: 0, sc: 0, elo: j.elo }; });
      partidos.forEach(p => {
        const s1 = p.score1, s2 = p.score2;
        if (stats[p.jugador1_id]) { stats[p.jugador1_id].sf += s1; stats[p.jugador1_id].sc += s2; }
        if (stats[p.jugador2_id]) { stats[p.jugador2_id].sf += s2; stats[p.jugador2_id].sc += s1; }
        if (s1 > s2) {
          if (stats[p.jugador1_id]) stats[p.jugador1_id].pts += 2;
          if (stats[p.jugador2_id] && s2 >= 1) stats[p.jugador2_id].pts += 1;
        } else if (s2 > s1) {
          if (stats[p.jugador2_id]) stats[p.jugador2_id].pts += 2;
          if (stats[p.jugador1_id] && s1 >= 1) stats[p.jugador1_id].pts += 1;
        }
      });

      Object.entries(stats)
        .sort(([, a], [, b]) => {
          if (b.pts !== a.pts) return b.pts - a.pts;
          const da = a.sf - a.sc, db2 = b.sf - b.sc;
          if (db2 !== da) return db2 - da;
          return b.sf - a.sf;
        })
        .slice(0, clasificadosPorGrupo)
        .forEach(([userId, s]) => allClasificados.push({ participanteId: userId, tipo: 'usuario', elo: s.elo }));
    });

    if (allClasificados.length < 2) return res.redirect('/admin?err=No hay suficientes clasificados para generar playoffs.');

    const resultado = generarBracketDirecto(db, torneo, allClasificados);
    if (resultado && resultado.error) return res.redirect('/admin?err=' + encodeURIComponent(resultado.error));

    res.redirect('/admin?msg=Playoffs generados correctamente.');
  } catch (e) {
    console.error('Error generar playoffs:', e);
    res.redirect('/admin?err=' + encodeURIComponent(e.message || 'Error al generar playoffs.'));
  } finally {
    try { db.close(); } catch {}
  }
});

// POST /api/torneos/desinscribir
router.post('/desinscribir', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneoId, userId } = req.body;
    const torneo = db.prepare('SELECT estado FROM torneos WHERE id = ?').get(torneoId);
    if (!torneo) return res.redirect('/admin?err=Torneo no encontrado.');
    if (torneo.estado !== 'inscripcion') return res.redirect('/admin?err=Solo se puede desinscribir durante la fase de inscripción.');

    db.prepare('DELETE FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').run(torneoId, userId);
    res.redirect('/admin?msg=Jugador removido correctamente.');
  } catch (e) {
    console.error('Error desinscribir:', e);
    res.redirect('/admin?err=' + encodeURIComponent('Error al desinscribir.'));
  } finally {
    db.close();
  }
});

module.exports = router;
