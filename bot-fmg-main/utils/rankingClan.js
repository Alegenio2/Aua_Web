const path = require('path');
const Database = require('better-sqlite3');

const CLAN_POR_DEFECTO = process.env.RANKING_CLAN_NOMBRE || 'FUMAG';

function getDB() {
  return new Database(path.resolve(process.cwd(), 'botfmg.db'));
}

function getRankingClanConfig(guildId) {
  try {
    const botConfig = require('../botConfig.json');
    const serverConfig = botConfig?.servidores?.[guildId] || {};
    const canalId = serverConfig.canalRankingClan || serverConfig.rankingClan?.[guildId] || process.env.RANKING_CLAN_CHANNEL_ID;
    return canalId || null;
  } catch (error) {
    console.warn('[RankingClan] No se pudo leer botConfig.json:', error.message);
    return process.env.RANKING_CLAN_CHANNEL_ID || null;
  }
}

function construirMensajeRankingClan(jugadores, clan = CLAN_POR_DEFECTO) {
  const encabezado = `**🏆 Ranking ELO Clan ${clan}**\n\n`;
  const filas = jugadores
    .slice()
    .sort((a, b) => b.elo - a.elo)
    .map((jugador, index) => `${index + 1}. ${jugador.nombre} — **ELO:** ${jugador.elo} — ${jugador.pais || 'Sin país'}`)
    .join('\n');

  return `${encabezado}${filas || 'No hay jugadores disponibles por el momento.'}`;
}

async function actualizarYPublicarRankingClan(client, guildId) {
  const canalId = getRankingClanConfig(guildId);
  if (!canalId) {
    console.log(`[RankingClan] No hay canal configurado para guild ${guildId}`);
    return;
  }

  const db = getDB();
  let jugadores = [];

  try {
    const usuarios = db.prepare(`
      SELECT nombre, elo, pais, country, clan
      FROM usuarios
      WHERE clan IS NOT NULL AND elo IS NOT NULL
    `).all();

    jugadores = usuarios.filter((usuario) => {
      const clan = usuario?.clan;
      return clan && clan.toUpperCase() === CLAN_POR_DEFECTO.toUpperCase();
    }).map((usuario) => ({
      nombre: usuario.nombre,
      elo: Number(usuario.elo),
      pais: usuario.pais || usuario.country || 'Sin país'
    }));
  } catch (error) {
    console.error('[RankingClan] Error leyendo usuarios del bot:', error);
    return;
  } finally {
    try { db.close(); } catch (error) {}
  }

  if (jugadores.length === 0) {
    console.log(`[RankingClan] No se encontraron jugadores del clan ${CLAN_POR_DEFECTO}.`);
    return;
  }

  const mensaje = construirMensajeRankingClan(jugadores, CLAN_POR_DEFECTO);

  try {
    const canal = await client.channels.fetch(canalId).catch(() => null);
    if (!canal || !canal.isTextBased?.()) {
      console.warn(`[RankingClan] No se pudo obtener un canal de texto válido para ${canalId}`);
      return;
    }

    const mensajes = await canal.messages.fetch({ limit: 20 });
    const ultimoMensajeBot = mensajes.find((msg) => msg.author.id === client.user?.id);

    if (ultimoMensajeBot) {
      await ultimoMensajeBot.delete().catch(() => {});
    }

    await canal.send(mensaje);
    console.log(`[RankingClan] Ranking publicado en ${canalId}`);
  } catch (error) {
    console.error('[RankingClan] Error al publicar el ranking:', error);
  }
}

module.exports = {
  actualizarYPublicarRankingClan,
  construirMensajeRankingClan
};
