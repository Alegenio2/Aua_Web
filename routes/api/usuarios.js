const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { obtenerEloActual } = require('../../lib/aoe2');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

const getDB = () => new Database(path.resolve(__dirname, '../../botfmg.db'));

// POST /api/usuarios/vincular
router.post('/vincular', requireAuth, async (req, res) => {
  const db = getDB();
  try {
    const { url } = req.body;
    const discordId = req.user.id;

    if (!discordId) return res.json({ success: false, error: 'ID de Discord no encontrado.' });

    const profileId = url?.split('/').filter(Boolean).pop();
    if (!profileId || isNaN(profileId)) {
      return res.json({ success: false, error: 'El link de AoE2 Companion no es válido.' });
    }

    const datosAoE = await obtenerEloActual(profileId);
    if (!datosAoE) return res.json({ success: false, error: 'No se encontró el perfil en la API.' });

    db.prepare(`
      INSERT OR REPLACE INTO usuarios (discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, elomax, ultimapartida, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      discordId, profileId, datosAoE.nombre,
      datosAoE.elo || 0, datosAoE.rank || 0,
      datosAoE.wins || 0, datosAoE.losses || 0,
      datosAoE.pais || '🇺🇾', datosAoE.country || 'uy',
      datosAoE.clan || '', datosAoE.elomax || datosAoE.elo || 0,
      new Date().toISOString(), JSON.stringify(datosAoE)
    );

    res.json({ success: true });
  } catch (e) {
    console.error('Error vincular:', e);
    res.json({ success: false, error: 'Error al guardar en la base de datos.' });
  } finally {
    db.close();
  }
});

module.exports = router;
