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
    const { nombre, tipo, formato, elo_min, elo_max, valor_handicap, cantidad_grupos, clasificados_por_grupo, elo_max_promedio, costo_inscripcion } = req.body;

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
    const eloMaxPromedio = elo_max_promedio ? (parseInt(elo_max_promedio) || null) : null;

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
    if (formato === 'grupos_eliminatoria') {
      cantGrupos = parseInt(cantidad_grupos) || 4;
      clasificadosGrupo = parseInt(clasificados_por_grupo) || 2;
    }

    const costoInscripcion = costo_inscripcion ? (parseInt(costo_inscripcion) || null) : null;

    db.prepare(`
      INSERT INTO torneos (id, nombre, slug, tipo, formato, elo_min, elo_max, redondeo_elo, estado, creado_en, cantidad_grupos, clasificados_por_grupo, elo_max_promedio, costo_inscripcion)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inscripcion', datetime('now'), ?, ?, ?, ?)
    `).run(id, nombre.trim(), slug, tipo, formato, eloMin, eloMax, redondeoElo, cantGrupos, clasificadosGrupo, eloMaxPromedio, costoInscripcion);

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
    const { torneoId, ordenGrupos = 'snake_elo' } = req.body;

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

    const resultado = await procesarGeneracionTorneo(torneoId, { ordenGrupos });
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

    const usuario = db.prepare('SELECT elo, nombre, profileId, elomax FROM usuarios WHERE discordId = ?').get(discordId);
    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);

    if (!usuario) return res.json({ success: false, error: 'Debes vincular tu perfil AoE2 primero.' });
    if (!torneo) return res.json({ success: false, error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'inscripcion') return res.json({ success: false, error: 'El torneo no está en fase de inscripción.' });

    // Actualizar ELO y ELO máximo desde aoe2companion antes de inscribir
    if (usuario.profileId) {
      const fresco = await obtenerEloActual(usuario.profileId).catch(() => null);
      if (fresco && !fresco.error) {
        const nuevoEloMax = Math.max(usuario.elomax || 0, fresco.elomax || 0);
        db.prepare(`
          UPDATE usuarios SET elo = ?, rank = ?, wins = ?, losses = ?, ultimapartida = ?, elomax = ? WHERE discordId = ?
        `).run(fresco.elo, fresco.rank, fresco.wins, fresco.losses, fresco.ultimapartida, nuevoEloMax, discordId);
        usuario.elo = fresco.elo;
        usuario.elomax = nuevoEloMax;
      }
    }

    const eloUsuario = usuario.elo || 0;
    const eloMaxUsuario = usuario.elomax || eloUsuario;
    const eloPromedio = Math.round((eloUsuario + eloMaxUsuario) / 2);

    if (eloPromedio < torneo.elo_min || eloPromedio > torneo.elo_max) {
      return res.json({ success: false, error: `Tu promedio de ELO (${eloPromedio}) no pertenece a esta categoría (${torneo.elo_min}–${torneo.elo_max}).` });
    }

    let eloInscripcion = eloPromedio;
    if (torneo.redondeo_elo > 0) {
      eloInscripcion = Math.round(eloPromedio / torneo.redondeo_elo) * torneo.redondeo_elo;
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

// POST /api/torneos/marcar-pago
router.post('/marcar-pago', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { torneoId, userId, pago } = req.body;
    if (!torneoId || !userId) return res.redirect('/admin?err=Datos incompletos.');
    db.prepare('UPDATE inscripciones SET pago = ? WHERE torneo_id = ? AND usuario_id = ?')
      .run(pago === '1' ? 1 : 0, torneoId, userId);
    res.redirect('/admin?msg=' + encodeURIComponent('Pago actualizado.'));
  } catch (e) {
    console.error('Error marcar-pago:', e);
    res.redirect('/admin?err=' + encodeURIComponent('Error al actualizar pago.'));
  } finally {
    db.close();
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

// POST /api/torneos/invitar — el inscripto invita a un compañero de equipo
router.post('/invitar', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const { torneoId, invitadoId, nombreEquipo } = req.body;
    const invitadorId = req.user.id;

    if (!torneoId || !invitadoId || !nombreEquipo?.trim()) {
      return res.json({ success: false, error: 'Faltan datos.' });
    }
    if (invitadorId === invitadoId) {
      return res.json({ success: false, error: 'No puedes invitarte a ti mismo.' });
    }

    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(torneoId);
    if (!torneo) return res.json({ success: false, error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'inscripcion') return res.json({ success: false, error: 'El torneo no está en fase de inscripción.' });
    if (!['2v2', '3v3', '4v4'].includes(torneo.tipo)) {
      return res.json({ success: false, error: 'Este torneo no es por equipos.' });
    }

    // El invitador debe estar inscripto y sin equipo aún
    const inscInvitador = db.prepare('SELECT equipo_id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(torneoId, invitadorId);
    if (!inscInvitador) return res.json({ success: false, error: 'Debes estar inscripto en el torneo para invitar.' });
    if (inscInvitador.equipo_id) return res.json({ success: false, error: 'Ya tenés un equipo en este torneo.' });

    // El invitado debe existir en la base (perfil vinculado)
    const invitado = db.prepare('SELECT discordId, nombre FROM usuarios WHERE discordId = ?').get(invitadoId);
    if (!invitado) return res.json({ success: false, error: 'El jugador invitado no tiene perfil vinculado.' });

    // El invitado no puede ya tener equipo en este torneo
    const inscInvitado = db.prepare('SELECT equipo_id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(torneoId, invitadoId);
    if (inscInvitado?.equipo_id) return res.json({ success: false, error: 'Ese jugador ya tiene equipo en este torneo.' });

    // No puede haber una invitación pendiente del invitador en este torneo
    const yaEnviada = db.prepare(`
      SELECT id FROM invitaciones_equipo
      WHERE torneo_id = ? AND invitador_id = ? AND estado = 'pendiente'
    `).get(torneoId, invitadorId);
    if (yaEnviada) return res.json({ success: false, error: 'Ya enviaste una invitación pendiente en este torneo. Cancélala primero.' });

    db.prepare(`
      INSERT INTO invitaciones_equipo (torneo_id, invitador_id, invitado_id, nombre_equipo, estado)
      VALUES (?, ?, ?, ?, 'pendiente')
    `).run(torneoId, invitadorId, invitadoId, nombreEquipo.trim());

    res.json({ success: true });
  } catch (e) {
    console.error('Error invitar:', e);
    res.json({ success: false, error: e.message });
  } finally {
    db.close();
  }
});

// POST /api/torneos/cancelar-invitacion — el invitador cancela su invitación pendiente
router.post('/cancelar-invitacion', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const { invitacionId } = req.body;
    const uid = req.user.id;
    const inv = db.prepare('SELECT * FROM invitaciones_equipo WHERE id = ?').get(invitacionId);
    if (!inv) return res.json({ success: false, error: 'Invitación no encontrada.' });
    if (inv.invitador_id !== uid) return res.json({ success: false, error: 'No autorizado.' });
    if (inv.estado !== 'pendiente') return res.json({ success: false, error: 'La invitación ya fue respondida.' });
    db.prepare("UPDATE invitaciones_equipo SET estado = 'cancelada' WHERE id = ?").run(invitacionId);
    res.json({ success: true });
  } catch (e) {
    console.error('Error cancelar-invitacion:', e);
    res.json({ success: false, error: e.message });
  } finally {
    db.close();
  }
});

// POST /api/torneos/responder-invitacion — el invitado acepta o rechaza
router.post('/responder-invitacion', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const { invitacionId, accion } = req.body; // accion: 'aceptar' | 'rechazar'
    const uid = req.user.id;

    if (!['aceptar', 'rechazar'].includes(accion)) {
      return res.json({ success: false, error: 'Acción inválida.' });
    }

    const inv = db.prepare('SELECT * FROM invitaciones_equipo WHERE id = ?').get(invitacionId);
    if (!inv) return res.json({ success: false, error: 'Invitación no encontrada.' });
    if (inv.invitado_id !== uid) return res.json({ success: false, error: 'Esta invitación no es para vos.' });
    if (inv.estado !== 'pendiente') return res.json({ success: false, error: 'La invitación ya fue respondida.' });

    if (accion === 'rechazar') {
      db.prepare("UPDATE invitaciones_equipo SET estado = 'rechazada' WHERE id = ?").run(invitacionId);
      return res.json({ success: true });
    }

    // — ACEPTAR —
    const torneo = db.prepare('SELECT * FROM torneos WHERE id = ?').get(inv.torneo_id);
    if (!torneo) return res.json({ success: false, error: 'Torneo no encontrado.' });
    if (torneo.estado !== 'inscripcion') return res.json({ success: false, error: 'El torneo ya no está en inscripción.' });

    // Verificar que el invitador sigue inscripto y sin equipo
    const inscInvitador = db.prepare('SELECT elo_inscripcion, equipo_id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(inv.torneo_id, inv.invitador_id);
    if (!inscInvitador) return res.json({ success: false, error: 'El invitador ya no está inscripto en el torneo.' });
    if (inscInvitador.equipo_id) return res.json({ success: false, error: 'El invitador ya tiene equipo.' });

    // Obtener ELO del invitado (actualizar si tiene profileId)
    const usuarioInvitado = db.prepare('SELECT elo, profileId FROM usuarios WHERE discordId = ?').get(uid);
    if (!usuarioInvitado) return res.json({ success: false, error: 'Perfil no encontrado.' });

    let eloInvitado = usuarioInvitado.elo || 0;
    if (usuarioInvitado.profileId) {
      const fresco = await require('../../lib/aoe2').obtenerEloActual(usuarioInvitado.profileId).catch(() => null);
      if (fresco && !fresco.error) {
        db.prepare('UPDATE usuarios SET elo=?, rank=?, wins=?, losses=?, ultimapartida=datetime(\'now\') WHERE discordId=?')
          .run(fresco.elo, fresco.rank, fresco.wins, fresco.losses, uid);
        eloInvitado = fresco.elo;
      }
    }

    // Validar ELO individual del invitado contra rango del torneo
    if (eloInvitado < torneo.elo_min || eloInvitado > torneo.elo_max) {
      return res.json({ success: false, error: `Tu ELO (${eloInvitado}) no está dentro del rango del torneo (${torneo.elo_min}–${torneo.elo_max}).` });
    }

    const eloInvitador = inscInvitador.elo_inscripcion;
    const elo1 = Math.round(eloInvitador / 50) * 50;
    const elo2 = Math.round(eloInvitado / 50) * 50;
    const eloPromedio = Math.round((elo1 + elo2) / 2);

    // Validar promedio si el torneo tiene cap
    if (torneo.elo_max_promedio !== null && eloPromedio > torneo.elo_max_promedio) {
      return res.json({ success: false, error: `El promedio de ELO del equipo (${eloPromedio}) supera el tope del torneo (${torneo.elo_max_promedio}).` });
    }

    db.transaction(() => {
      // Crear equipo
      const result = db.prepare(`
        INSERT INTO equipos (torneo_id, nombre, jugador1_id, jugador2_id, elo1, elo2, elo_promedio)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(inv.torneo_id, inv.nombre_equipo, inv.invitador_id, uid, elo1, elo2, eloPromedio);

      const equipoId = result.lastInsertRowid;

      // Registrar al invitado si no está inscripto, o actualizar su inscripción
      const yaInscripto = db.prepare('SELECT id FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(inv.torneo_id, uid);
      if (yaInscripto) {
        db.prepare('UPDATE inscripciones SET equipo_id = ? WHERE torneo_id = ? AND usuario_id = ?')
          .run(equipoId, inv.torneo_id, uid);
      } else {
        const eloRed = torneo.redondeo_elo > 0 ? Math.round(eloInvitado / torneo.redondeo_elo) * torneo.redondeo_elo : eloInvitado;
        db.prepare('INSERT INTO inscripciones (torneo_id, usuario_id, elo_inscripcion, equipo_id) VALUES (?, ?, ?, ?)')
          .run(inv.torneo_id, uid, eloRed, equipoId);
      }

      // Asignar equipo al invitador
      db.prepare('UPDATE inscripciones SET equipo_id = ? WHERE torneo_id = ? AND usuario_id = ?')
        .run(equipoId, inv.torneo_id, inv.invitador_id);

      // Marcar invitación como aceptada y cancelar otras pendientes del invitado en el mismo torneo
      db.prepare("UPDATE invitaciones_equipo SET estado = 'aceptada' WHERE id = ?").run(invitacionId);
      db.prepare(`
        UPDATE invitaciones_equipo SET estado = 'cancelada'
        WHERE torneo_id = ? AND invitado_id = ? AND estado = 'pendiente' AND id != ?
      `).run(inv.torneo_id, uid, invitacionId);
    })();

    res.json({ success: true });
  } catch (e) {
    console.error('Error responder-invitacion:', e);
    res.json({ success: false, error: e.message });
  } finally {
    db.close();
  }
});

module.exports = router;
