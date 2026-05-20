const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { buscarEstadisticasEncuentro } = require('../../utils/aoe2stats');
const { actualizarPuntosPenca } = require('../../lib/penca');

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
      SELECT p.*, u1.profileId as id1, u2.profileId as id2
      FROM partidos p
      JOIN usuarios u1 ON p.jugador1_id = u1.discordId
      JOIN usuarios u2 ON p.jugador2_id = u2.discordId
      WHERE p.id = ?
    `).get(partidoId);

    if (!partido) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.json({ error: 'Partido no encontrado.' });
    }

    let rec_link_path = partido.rec_link || null;

    if (req.file) {
      const safeId1 = String(partido.id1).replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeId2 = String(partido.id2).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `u1_${safeId1}_vs_u2_${safeId2}_partido_${partidoId}.zip`;
      const uploadDir = path.join(__dirname, '../../public/recs');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      fs.renameSync(req.file.path, path.join(uploadDir, fileName));
      rec_link_path = `/recs/${fileName}`;
    }

    if (!rec_link_path) return res.json({ error: 'El archivo ZIP de las grabaciones es obligatorio.' });

    const ganadorId = score1 > score2 ? partido.jugador1_id : partido.jugador2_id;

    db.prepare(`
      UPDATE partidos SET score1=?, score2=?, ganador_id=?, draftmap=?, draftcivs=?, rec_link=?, estado='finalizado', fecha=datetime('now')
      WHERE id=?
    `).run(score1, score2, ganadorId, draftmap, draftcivs, rec_link_path, partidoId);

    const partidasApi = await buscarEstadisticasEncuentro(partido.id1, partido.id2, score1 + score2);
    if (partidasApi?.length > 0) {
      const stmt = db.prepare('INSERT INTO partidas_stats (partido_id, mapa, civilizacion_1, civilizacion_2, ganador_id, duracion) VALUES (?, ?, ?, ?, ?, ?)');
      for (const mapa of partidasApi) {
        stmt.run(partidoId, mapa.nombre_mapa, mapa.jugador1.civ, mapa.jugador2.civ, mapa.ganador_aoe2id, mapa.duracion);
      }
    }

    actualizarPuntosPenca(partidoId, score1, score2);

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

    db.prepare('UPDATE partidos SET coordinado = ? WHERE id = ?').run(fecha_hora.replace('T', ' '), partidoId);
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

      const partido = db.prepare('SELECT jugador1_id, jugador2_id FROM partidos WHERE id = ?').get(partidoId);
      if (!partido) return res.redirect('/admin/penca?err=Partido no encontrado.');

      const ganadorId = s1 > s2 ? partido.jugador1_id : partido.jugador2_id;
      db.prepare(`UPDATE partidos SET score1=?, score2=?, ganador_id=?, estado='finalizado', cuenta_penca=?, fecha=datetime('now') WHERE id=?`)
        .run(s1, s2, ganadorId, cuentaPenca, partidoId);

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

// POST /api/partidos/walkover  (admin)
router.post('/walkover', requireAdmin, (req, res) => {
  const db = getDB();
  try {
    const { partidoId, ganadorId } = req.body;
    if (!partidoId || !ganadorId) return res.redirect('/admin/partidos?err=Datos incompletos.');

    const partido = db.prepare('SELECT jugador1_id, jugador2_id, cuenta_penca FROM partidos WHERE id = ?').get(partidoId);
    if (!partido) return res.redirect('/admin/partidos?err=Partido no encontrado.');
    if (ganadorId !== partido.jugador1_id && ganadorId !== partido.jugador2_id) {
      return res.redirect('/admin/partidos?err=Ganador inválido.');
    }

    const s1 = ganadorId === partido.jugador1_id ? 2 : 0;
    const s2 = ganadorId === partido.jugador2_id ? 2 : 0;

    db.prepare(`UPDATE partidos SET score1=?, score2=?, ganador_id=?, estado='finalizado', fecha=datetime('now') WHERE id=?`)
      .run(s1, s2, ganadorId, partidoId);

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
