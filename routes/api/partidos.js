const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');
const { buscarEstadisticasEncuentro } = require('../../utils/aoe2stats');
const { actualizarPuntosPenca } = require('../../lib/penca');
const { subirRecGit } = require('../../lib/recsGit');

const router = express.Router();

const upload = multer({
  dest: path.join(__dirname, '../../public/recs_tmp'),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

function requireAdmin(req, res, next) {
  const admins = (process.env.ADMIN_DISCORDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!req.user || !admins.includes(req.user.id)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

const getDB = () => new Database(path.resolve(__dirname, '../../botfmg.db'));

// Asigna el ganador de un partido de bracket al slot correcto en la siguiente ronda
function avanzarBracket(db, partidoId, ganadorId) {
  const id = Number(partidoId);
  const partido = db.prepare(
    'SELECT torneo_id, fase, ronda, jugador1_id, jugador2_id, equipo1_id, equipo2_id FROM partidos WHERE id = ?'
  ).get(id);
  if (!partido) return;

  const fasesEliminacion = ['eliminatoria', 'octavos', 'cuartos', 'semis'];
  if (!fasesEliminacion.includes(partido.fase)) return;

  const rondasActual = db.prepare(
    'SELECT id FROM partidos WHERE torneo_id = ? AND fase = ? AND ronda = ? ORDER BY id'
  ).all(partido.torneo_id, partido.fase, partido.ronda);

  const posicion = rondasActual.findIndex(p => p.id === id);
  if (posicion === -1) return;

  const proximosPartidos = db.prepare(
    'SELECT id FROM partidos WHERE torneo_id = ? AND fase = ? AND ronda = ? ORDER BY id'
  ).all(partido.torneo_id, partido.fase, partido.ronda + 1);

  const proximoPartido = proximosPartidos[Math.floor(posicion / 2)];
  if (!proximoPartido) return; // era la final, no hay siguiente

  const esEquipo = !!(partido.equipo1_id || partido.equipo2_id);
  const esSlot1  = posicion % 2 === 0;

  if (esEquipo) {
    if (esSlot1) db.prepare('UPDATE partidos SET equipo1_id = ? WHERE id = ?').run(ganadorId, proximoPartido.id);
    else         db.prepare('UPDATE partidos SET equipo2_id = ? WHERE id = ?').run(ganadorId, proximoPartido.id);
  } else {
    if (esSlot1) db.prepare('UPDATE partidos SET jugador1_id = ? WHERE id = ?').run(ganadorId, proximoPartido.id);
    else         db.prepare('UPDATE partidos SET jugador2_id = ? WHERE id = ?').run(ganadorId, proximoPartido.id);
  }
}

// POST /api/partidos/resultado
router.post('/resultado', requireAuth, upload.single('rec_file'), async (req, res) => {
  const db = getDB();
  try {
    const { partidoId, score1: s1Raw, score2: s2Raw, draftmap, draftcivs } = req.body;
    const score1 = parseInt(s1Raw);
    const score2 = parseInt(s2Raw);

    if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.json({ error: 'Los scores deben ser números válidos y no negativos.' });
    }

    const partido = db.prepare(`
      SELECT p.*, t.nombre as torneo_nombre,
             u1.profileId as id1, u2.profileId as id2,
             u1.nombre as j1_nombre, u2.nombre as j2_nombre,
             e1.nombre as equipo1_nombre, e2.nombre as equipo2_nombre
      FROM partidos p
      LEFT JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      LEFT JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      LEFT JOIN equipos  e1 ON p.equipo1_id  = e1.id
      LEFT JOIN equipos  e2 ON p.equipo2_id  = e2.id
      LEFT JOIN torneos  t  ON p.torneo_id   = t.id
      WHERE p.id = ?
    `).get(partidoId);

    if (!partido) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.json({ error: 'Partido no encontrado.' });
    }

    let rec_link_path = partido.rec_link || null;

    if (req.file) {
      const ref1 = partido.equipo1_id ? `equipo${partido.equipo1_id}` : String(partido.id1 || 'j1');
      const ref2 = partido.equipo2_id ? `equipo${partido.equipo2_id}` : String(partido.id2 || 'j2');
      const safeId1 = ref1.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeId2 = ref2.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `u1_${safeId1}_vs_u2_${safeId2}_partido_${partidoId}.zip`;
      const uploadDir = path.join(__dirname, '../../public/recs');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      fs.renameSync(req.file.path, path.join(uploadDir, fileName));
      rec_link_path = `/recs/${fileName}`;
    }

    if (!rec_link_path) return res.json({ error: 'El archivo ZIP de las grabaciones es obligatorio.' });

    const ganadorId = score1 > score2
      ? (partido.equipo1_id || partido.jugador1_id)
      : (partido.equipo2_id || partido.jugador2_id);

    db.prepare(`
      UPDATE partidos SET score1=?, score2=?, ganador_id=?, draftmap=?, draftcivs=?, rec_link=?, estado='finalizado', fecha=datetime('now')
      WHERE id=?
    `).run(score1, score2, ganadorId, draftmap, draftcivs, rec_link_path, partidoId);

    avanzarBracket(db, partidoId, ganadorId);

    const partidasApi = await buscarEstadisticasEncuentro(partido.id1, partido.id2, score1 + score2);
    if (partidasApi?.length > 0) {
      const stmt = db.prepare('INSERT INTO partidas_stats (partido_id, mapa, civilizacion_1, civilizacion_2, ganador_id, duracion) VALUES (?, ?, ?, ?, ?, ?)');
      for (const mapa of partidasApi) {
        stmt.run(partidoId, mapa.nombre_mapa, mapa.jugador1.civ, mapa.jugador2.civ, mapa.ganador_aoe2id, mapa.duracion);
      }
    }

    actualizarPuntosPenca(partidoId, score1, score2);

    // Subir rec a GitHub en background (no bloquea la respuesta)
    if (rec_link_path) {
      const filename = require('path').basename(rec_link_path);
      subirRecGit(filename).catch(e => console.error('[RECS-GIT] Error subida:', e.message));
    }

    const chResult = process.env.DISCORD_RESULTADOS_CHANNEL;
    if (chResult && req.app.locals.notifyDiscord) {
      const ganadorNombre = score1 > score2 ? partido.j1_nombre : partido.j2_nombre;
      const embed = new EmbedBuilder()
        .setTitle('Resultado cargado')
        .setColor('#f59e0b')
        .setDescription(`**${partido.j1_nombre}** ${score1} – ${score2} **${partido.j2_nombre}**`)
        .addFields(
          { name: 'Torneo', value: partido.torneo_nombre || '—', inline: true },
          { name: 'Ganador', value: ganadorNombre, inline: true }
        )
        .setTimestamp();
      req.app.locals.notifyDiscord(chResult, { embeds: [embed] });
    }

    res.json({ success: true, message: 'Resultado guardado correctamente.' });
  } catch (e) {
    console.error('Error resultado:', e);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.json({ error: 'Error al procesar el resultado.' });
  } finally {
    db.close();
  }
});

// POST /api/partidos/coordinar
router.post('/coordinar', requireAuth, (req, res) => {
  const db = getDB();
  try {
    const { partidoId, fecha_hora } = req.body;
    if (!partidoId || !fecha_hora) return res.json({ error: 'Datos incompletos.' });

    if (isNaN(new Date(fecha_hora).getTime())) return res.json({ error: 'Fecha y hora inválidas.' });

    const partido = db.prepare(`
      SELECT p.*, u1.nombre as j1_nombre, u2.nombre as j2_nombre, t.nombre as torneo_nombre
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      LEFT JOIN torneos t ON p.torneo_id = t.id
      WHERE p.id = ?
    `).get(partidoId);

    if (!partido) return res.json({ error: 'Partido no encontrado.' });

    const dateAsUTC = new Date(fecha_hora);
    const dateURYToUTC = new Date(dateAsUTC.getTime() + 3 * 60 * 60 * 1000);
    const dateUTC = dateURYToUTC.toISOString().slice(0, 19).replace('T', ' ');
    db.prepare('UPDATE partidos SET coordinado = ? WHERE id = ?').run(dateUTC, partidoId);

    const chCoord = process.env.DISCORD_COORDINADOS_CHANNEL;
    if (chCoord && req.app.locals.notifyDiscord) {
      const fechaObj = new Date(fecha_hora);
      const fechaFormateada = fechaObj.toLocaleString('es-UY', {
        timeZone: 'America/Montevideo',
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      const embed = new EmbedBuilder()
        .setTitle('Partido coordinado')
        .setColor('#22c55e')
        .setDescription(`**${partido.j1_nombre}** vs **${partido.j2_nombre}**`)
        .addFields(
          { name: 'Torneo', value: partido.torneo_nombre || '—', inline: true },
          { name: 'Fecha y hora', value: fechaFormateada, inline: true }
        )
        .setTimestamp();
      req.app.locals.notifyDiscord(chCoord, { embeds: [embed] });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Error coordinar:', e);
    res.json({ error: 'Error al coordinar el partido.' });
  } finally {
    db.close();
  }
});

// POST /api/partidos/penca  (admin)
router.post('/penca', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { partidoId, score1, score2, cuenta_penca } = req.body;
    const cuentaPenca = cuenta_penca === '1' ? 1 : 0;

    if (!partidoId) return res.redirect('/admin/penca?err=ID de partido no recibido.');

    if (score1 !== undefined && score1 !== '' && score2 !== undefined && score2 !== '') {
      const s1 = parseInt(score1);
      const s2 = parseInt(score2);
      if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
        return res.redirect('/admin/penca?err=' + encodeURIComponent('Scores inválidos.'));
      }

      const partido = db.prepare('SELECT jugador1_id, jugador2_id, equipo1_id, equipo2_id FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return res.redirect('/admin/penca?err=Partido no encontrado.');

      const ganadorId = s1 > s2
        ? (partido.equipo1_id || partido.jugador1_id)
        : (partido.equipo2_id || partido.jugador2_id);
      db.prepare(`UPDATE partidos SET score1=?, score2=?, ganador_id=?, estado='finalizado', cuenta_penca=?, fecha=datetime('now') WHERE id=?`)
        .run(s1, s2, ganadorId, cuentaPenca, partidoId);

      avanzarBracket(db, partidoId, ganadorId);
      if (cuentaPenca === 1) {
        actualizarPuntosPenca(partidoId, s1, s2);
      } else {
        db.prepare('UPDATE penca_votos SET puntos_obtenidos = 0 WHERE partido_id = ?').run(partidoId);
      }
    } else {
      db.prepare('UPDATE partidos SET cuenta_penca = ? WHERE id = ?').run(cuentaPenca, partidoId);
    }

    res.redirect('/admin/penca?msg=' + encodeURIComponent('Guardado correctamente.'));
  } catch (e) {
    console.error('Error penca admin:', e);
    res.redirect('/admin/penca?err=' + encodeURIComponent('Error al gestionar partido.'));
  } finally {
    db.close();
  }
});

// POST /api/partidos/editar-resultado  (admin)
router.post('/editar-resultado', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { partidoId, score1, score2, cuenta_penca } = req.body;
    const s1 = parseInt(score1);
    const s2 = parseInt(score2);
    const cuentaPenca = cuenta_penca === '1' ? 1 : 0;

    if (!partidoId || isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
      return res.redirect('/admin/resultados?err=' + encodeURIComponent('Datos inválidos.'));
    }
    if (s1 === s2) {
      return res.redirect('/admin/resultados?err=' + encodeURIComponent('El resultado no puede ser empate.'));
    }

    const partido = db.prepare('SELECT jugador1_id, jugador2_id, equipo1_id, equipo2_id FROM partidos WHERE id = ? AND estado = ?').get(partidoId, 'finalizado');
    if (!partido) return res.redirect('/admin/resultados?err=' + encodeURIComponent('Partido no encontrado.'));

    const ganadorId = s1 > s2
      ? (partido.equipo1_id || partido.jugador1_id)
      : (partido.equipo2_id || partido.jugador2_id);
    db.prepare(`UPDATE partidos SET score1=?, score2=?, ganador_id=?, cuenta_penca=?, fecha=datetime('now') WHERE id=?`)
      .run(s1, s2, ganadorId, cuentaPenca, partidoId);

    if (cuentaPenca === 1) {
      actualizarPuntosPenca(partidoId, s1, s2);
    } else {
      db.prepare('UPDATE penca_votos SET puntos_obtenidos = 0 WHERE partido_id = ?').run(partidoId);
    }

    res.redirect('/admin/resultados?msg=' + encodeURIComponent('Resultado actualizado correctamente.'));
  } catch (e) {
    console.error('Error editar resultado:', e);
    res.redirect('/admin/resultados?err=' + encodeURIComponent('Error al actualizar el resultado.'));
  } finally {
    db.close();
  }
});

// POST /api/partidos/walkover  (admin)
router.post('/walkover', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { partidoId, ganadorId } = req.body;
    if (!partidoId || !ganadorId) return res.redirect('/admin/partidos?err=Datos incompletos.');

    const partido = db.prepare('SELECT jugador1_id, jugador2_id, equipo1_id, equipo2_id, cuenta_penca FROM partidos WHERE id = ?').get(partidoId);
    if (!partido) return res.redirect('/admin/partidos?err=Partido no encontrado.');

    const id1 = partido.equipo1_id || partido.jugador1_id;
    const id2 = partido.equipo2_id || partido.jugador2_id;
    if (String(ganadorId) !== String(id1) && String(ganadorId) !== String(id2)) {
      return res.redirect('/admin/partidos?err=Ganador inválido.');
    }

    const s1 = String(ganadorId) === String(id1) ? 2 : 0;
    const s2 = String(ganadorId) === String(id2) ? 2 : 0;

    db.prepare(`UPDATE partidos SET score1=?, score2=?, ganador_id=?, estado='finalizado', fecha=datetime('now') WHERE id=?`)
      .run(s1, s2, ganadorId, partidoId);

    avanzarBracket(db, partidoId, ganadorId);
    if (partido.cuenta_penca) actualizarPuntosPenca(partidoId, s1, s2);

    res.redirect('/admin/partidos?msg=' + encodeURIComponent('Walkover registrado correctamente.'));
  } catch (e) {
    console.error('Error walkover:', e);
    res.redirect('/admin/partidos?err=' + encodeURIComponent('Error al registrar walkover.'));
  } finally {
    db.close();
  }
});

module.exports = router;
