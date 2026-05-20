const DELAY_MS = 500;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function obtenerEloActual(profileId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'aldeano-oscar-bot/1.0 (jabstv2@gmail.com)' }
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.leaderboards) return null;

    const lb1v1 = data.leaderboards.find(lb => lb.leaderboardId === 'rm_1v1');
    if (!lb1v1) return null;

    return {
      nombre: data.name,
      elo: lb1v1.rating,
      rank: lb1v1.rank,
      wins: lb1v1.wins,
      losses: lb1v1.losses,
      pais: data.countryIcon,
      country: data.country,
      clan: data.clan || null,
      elomax: lb1v1.maxRating,
      ultimapartida: lb1v1.lastMatchTime || null,
      fullData: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error API AoE2:', error.message);
    return null;
  } finally {
    await delay(DELAY_MS);
  }
}

module.exports = { obtenerEloActual };
