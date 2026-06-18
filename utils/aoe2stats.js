/**
 * utils/aoe2stats.js
 * Versión optimizada para Web/SQL
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Auxiliar para peticiones API ---
function httpGet(hostname, path, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname, path, method: 'GET',
        headers: { 'User-Agent': 'bot-fmg/1.0', Accept: 'application/json' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch (e) { reject(new Error("JSON inválido")); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

// --- Busca partidas en la API ---
async function fetchPartidas(profileId) {
  const path = `/api/matches?profile_ids=${profileId}&use_enums=true&page=1&per_page=100`;
  const data = await httpGet('data.aoe2companion.com', path);
  return Array.isArray(data) ? data : (data.matches ?? []);
}

// --- Extrae info simplificada para SQL ---
function extraerInfoMapa(match, aoe2Id1, aoe2Id2) {
  const id1 = String(aoe2Id1);
  const id2 = String(aoe2Id2);
  let p1 = null, p2 = null;

  for (const team of (match.teams ?? [])) {
    for (const p of (team.players ?? [])) {
      const pid = String(p.profileId ?? '');
      if (pid === id1) p1 = p;
      if (pid === id2) p2 = p;
    }
  }

  // CALCULAR DURACIÓN EN SEGUNDOS
  const duracionSegundos = match.finished && match.started
    ? Math.round((new Date(match.finished) - new Date(match.started)) / 1000)
    : 0;

  return {
    nombre_mapa: match.mapName ?? 'Desconocido',
    duracion: duracionSegundos, // <--- Nuevo campo
    jugador1: { civ: p1?.civName ?? '?', gano: p1?.won === true },
    jugador2: { civ: p2?.civName ?? '?', gano: p2?.won === true },
    ganador_aoe2id: p1?.won ? id1 : (p2?.won ? id2 : null)
  };
}

/**
 * FUNCIÓN PRINCIPAL ADAPTADA A SQL
 * @param {string} aoe2Id1 - ID de AoE2 del primer jugador
 * @param {string} aoe2Id2 - ID de AoE2 del segundo jugador
 * @param {number} totalPartidas - Cuántos mapas se jugaron (ej: 3 en un 2-1)
 */
async function buscarEstadisticasEncuentro(aoe2Id1, aoe2Id2, totalPartidas) {
  if (!aoe2Id1 || !aoe2Id2) return null;

  let matches;
  try {
    matches = await fetchPartidas(aoe2Id1);
  } catch (e) {
    console.error(`❌ Error API AoE2: ${e.message}`);
    return null;
  }

  // Filtrar solo duelos unranked entre ellos dos
  const duelos = matches.filter(match => {
    let team1 = null, team2 = null;
    for (const team of (match.teams ?? [])) {
      for (const p of (team.players ?? [])) {
        const pid = String(p.profileId ?? '');
        if (pid === String(aoe2Id1)) team1 = team.teamId;
        if (pid === String(aoe2Id2)) team2 = team.teamId;
      }
    }
    return team1 !== null && team2 !== null && team1 !== team2;
  });

  if (duelos.length === 0) return null;

  // Ordenar por fecha reciente
  duelos.sort((a, b) => new Date(b.started) - new Date(a.started));

  const filtrados = [];
  for (let i = 0; i < duelos.length; i++) {
    const actual = duelos[i];
    
    // Filtro 8 min (480s)
    const duracion = (new Date(actual.finished) - new Date(actual.started)) / 1000;
    if (duracion < 480) continue; 

    // Filtro Restore
    const siguiente = duelos[i + 1];
    if (siguiente && actual.mapName === siguiente.mapName) {
      const diffHoras = Math.abs(new Date(actual.started) - new Date(siguiente.started)) / 3600000;
      if (diffHoras < 1.5) {
        filtrados.push(actual);
        i++; // Saltamos el restore
        continue;
      }
    }
    filtrados.push(actual);
  }

  // Retornamos solo la cantidad de mapas jugados en el encuentro
  return filtrados.slice(0, totalPartidas).map(m => extraerInfoMapa(m, aoe2Id1, aoe2Id2));
}

module.exports = { buscarEstadisticasEncuentro };