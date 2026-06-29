const https = require('https');
const DELAY_MS = 500;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'aldeano-oscar-bot/1.0 (jabstv2@gmail.com)' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

async function obtenerEloActual(profileId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;
  try {
    const { status, data } = await fetchUrl(url);
    if (status === 404) return { error: 'profile_not_found' };
    if (status !== 200) return { error: 'api_error', status };

    // Estructura: leaderboards array contiene datos actuales
    const lb1v1 = data.leaderboards?.find(lb => lb.leaderboardId === 'rm_1v1');

    return {
      nombre: data.name,
      elo: lb1v1?.rating ?? null,
      rank: lb1v1?.rank ?? null,
      wins: lb1v1?.wins ?? null,
      losses: lb1v1?.losses ?? null,
      pais: data.countryIcon ?? null,
      country: data.country ?? null,
      clan: data.clan || null,
      elomax: lb1v1?.maxRating ?? null,
      ultimapartida: lb1v1?.lastMatchTime ?? null,
      sin1v1: !lb1v1,
      fullData: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error API AoE2:', error.message);
    return null;
  } finally {
    await delay(DELAY_MS);
  }
}

function obtenerEstadsLocales(profileId, discordId) {
  if (!discordId) return { racha: null, civFavorita: null, mapFavorita: null, totalPartidosLocal: 0 };

  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.resolve(process.cwd(), 'botfmg.db'));
  try {
    // Obtener civs y mapas favoritos de partidas_stats
    const stats = db.prepare(`
      SELECT ps.mapa,
             CASE WHEN p.jugador1_id = ? THEN ps.civilizacion_1 ELSE ps.civilizacion_2 END as civ_jugado,
             CASE WHEN p.jugador1_id = ? THEN ps.ganador_id = p.jugador1_id ELSE ps.ganador_id = p.jugador2_id END as gano
      FROM partidas_stats ps
      JOIN partidos p ON ps.partido_id = p.id
      WHERE (p.jugador1_id = ? OR p.jugador2_id = ?)
      ORDER BY ps.partido_id DESC
      LIMIT 50
    `).all(discordId, discordId, discordId, discordId);

    const civStats = {}, mapStats = {};
    let winStreak = 0, lossStreak = 0;

    stats.forEach((s, idx) => {
      // Civs
      if (s.civ_jugado && s.civ_jugado !== 'Desconocida') {
        civStats[s.civ_jugado] = (civStats[s.civ_jugado] || 0) + 1;
      }
      // Mapas
      if (s.mapa && s.mapa !== 'Desconocido') {
        mapStats[s.mapa] = (mapStats[s.mapa] || 0) + 1;
      }
      // Racha (últimos 5)
      if (idx < 5) {
        if (s.gano) {
          winStreak++;
          lossStreak = 0;
        } else {
          lossStreak++;
          winStreak = 0;
        }
      }
    });

    const civFavorita = Object.keys(civStats).length > 0
      ? Object.keys(civStats).reduce((a, b) => civStats[a] > civStats[b] ? a : b)
      : null;

    const mapFavorita = Object.keys(mapStats).length > 0
      ? Object.keys(mapStats).reduce((a, b) => mapStats[a] > mapStats[b] ? a : b)
      : null;

    return {
      racha: winStreak > 0 ? { tipo: 'win', cantidad: winStreak } :
             lossStreak > 0 ? { tipo: 'loss', cantidad: lossStreak } : null,
      civFavorita,
      mapFavorita,
      totalPartidosLocal: stats.length
    };
  } catch (error) {
    console.error('Error obteniendo stats locales:', error.message);
    return { racha: null, civFavorita: null, mapFavorita: null, totalPartidosLocal: 0 };
  } finally {
    try { db.close(); } catch (e) {}
  }
}

async function obtenerDatosJugadorCompl(profileId, discordId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;
  try {
    const { status, data } = await fetchUrl(url);
    if (status === 404) return { error: 'profile_not_found' };
    if (status !== 200) return { error: 'api_error', status };

    // Estructura: leaderboards array
    const lb1v1 = data.leaderboards?.find(lb => lb.leaderboardId === 'rm_1v1');

    // Obtener stats locales si tenemos discordId
    let estadisticas = { racha: null, civFavorita: null, mapFavorita: null, totalPartidosLocal: 0 };
    if (discordId) {
      estadisticas = obtenerEstadsLocales(profileId, discordId);
    }

    return {
      nombre: data.name,
      elo: lb1v1?.rating ?? null,
      elomax: lb1v1?.maxRating ?? null,
      rank: lb1v1?.rank ?? null,
      wins: lb1v1?.wins ?? null,
      losses: lb1v1?.losses ?? null,
      pais: data.countryIcon ?? null,
      country: data.country ?? null,
      clan: data.clan || null,
      racha: estadisticas.racha,
      civFavorita: estadisticas.civFavorita,
      mapFavorita: estadisticas.mapFavorita,
      totalPartidos: estadisticas.totalPartidosLocal,
      profileId: profileId
    };
  } catch (error) {
    console.error('Error API AoE2:', error.message);
    return null;
  } finally {
    await delay(DELAY_MS);
  }
}

module.exports = { obtenerEloActual, obtenerDatosJugadorCompl };
