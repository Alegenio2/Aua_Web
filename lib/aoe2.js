const DELAY_MS = 500;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function obtenerEloActual(profileId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'aldeano-oscar-bot/1.0 (jabstv2@gmail.com)' }
    });
    if (!res.ok) {
      if (res.status === 404) return { error: 'profile_not_found' };
      return { error: 'api_error', status: res.status };
    }

    const data = await res.json();
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

module.exports = { obtenerEloActual };
