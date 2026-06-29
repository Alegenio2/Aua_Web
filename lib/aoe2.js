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

async function obtenerDatosJugadorCompl(profileId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;
  try {
    const { status, data } = await fetchUrl(url);
    if (status === 404) return { error: 'profile_not_found' };
    if (status !== 200) return { error: 'api_error', status };

    // Estructura: leaderboards array
    const lb1v1 = data.leaderboards?.find(lb => lb.leaderboardId === 'rm_1v1');

    // Extraer matches para calcular racha y estadísticas
    const matches = data.matches || [];
    let winStreak = 0, lossStreak = 0;
    let civFavorita = null, mapFavorita = null;

    // Calcular racha (últimos 5 partidos)
    for (let i = 0; i < Math.min(5, matches.length); i++) {
      const m = matches[i];
      if (m.result === 'w') {
        winStreak++;
        lossStreak = 0;
      } else {
        lossStreak++;
        winStreak = 0;
      }
    }

    // Civs totales para ranking
    const civTotales = {};
    matches.forEach(m => {
      if (m.civilization) {
        civTotales[m.civilization] = (civTotales[m.civilization] || 0) + 1;
      }
    });
    civFavorita = Object.keys(civTotales).length > 0
      ? Object.keys(civTotales).reduce((a, b) => civTotales[a] > civTotales[b] ? a : b)
      : null;

    // Mapas totales para ranking
    const mapTotales = {};
    matches.forEach(m => {
      if (m.map_name) {
        mapTotales[m.map_name] = (mapTotales[m.map_name] || 0) + 1;
      }
    });
    mapFavorita = Object.keys(mapTotales).length > 0
      ? Object.keys(mapTotales).reduce((a, b) => mapTotales[a] > mapTotales[b] ? a : b)
      : null;

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
      racha: winStreak > 0 ? { tipo: 'win', cantidad: winStreak } :
             lossStreak > 0 ? { tipo: 'loss', cantidad: lossStreak } : null,
      civFavorita: civFavorita,
      mapFavorita: mapFavorita,
      totalPartidos: matches.length,
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
