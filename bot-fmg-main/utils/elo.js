// utils/elo.js
const DELAY_MS = 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function obtenerEloActual(profileId) {
  const url = `https://data.aoe2companion.com/api/profiles/${profileId}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "aldeano-oscar-bot/1.0 (jabstv2@gmail.com)"
      }
    });

    if (!res.ok) {
      if (res.status === 404) return { error: 'profile_not_found' };
      return { error: 'api_error', status: res.status };
    }

    const data = await res.json();

    if (!data.leaderboards || data.leaderboards.length === 0) {
      return { error: 'no_1v1_rank' };
    }

    const leaderboard1v1 = data.leaderboards.find(lb => lb.leaderboardId === 'rm_1v1');
    if (!leaderboard1v1) {
      return { error: 'no_1v1_rank' };
    }

    return {
      nombre: data.name,
      elo: leaderboard1v1.rating,
      rank: leaderboard1v1.rank,
      wins: leaderboard1v1.wins,
      losses: leaderboard1v1.losses,
      pais: data.countryIcon,
      country: data.country,
      clan: data.clan || null,
      elomax: leaderboard1v1.maxRating,
      ultimapartida: leaderboard1v1.lastMatchTime || null,
    };
  } catch (error) {
    console.error("Error al obtener ELO:", error);
    return null;
  } finally {
    // forzar delay después de cada request
    await delay(DELAY_MS);
  }
}

module.exports = { obtenerEloActual };

