// comandos/duelo.js
const { ApplicationCommandOptionType } = require('discord.js');
const Database = require('better-sqlite3');
const path = require('path');

const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

module.exports = {
  name: 'duelo',
  description: 'Calcula el hándicap recomendado para un duelo entre dos jugadores del torneo.',
  options: [
    {
      name: 'jugador1',
      description: 'Primer jugador',
      type: ApplicationCommandOptionType.User,
      required: true,
    },
    {
      name: 'jugador2',
      description: 'Segundo jugador',
      type: ApplicationCommandOptionType.User,
      required: true,
    },
  ],

  async execute(interaction) {
    const j1 = interaction.options.getUser('jugador1');
    const j2 = interaction.options.getUser('jugador2');

    if (j1.id === j2.id) {
      return interaction.reply('❌ Debés elegir dos usuarios distintos.');
    }

    const db = getDB();
    try {
      const partido = db.prepare(`
        SELECT p.*, t.nombre AS torneo_nombre, t.slug AS torneo_slug, t.estado AS torneo_estado
        FROM partidos p
        LEFT JOIN torneos t ON p.torneo_id = t.id
        WHERE (p.jugador1_id = ? AND p.jugador2_id = ?) OR (p.jugador1_id = ? AND p.jugador2_id = ?)
        ORDER BY p.id DESC
        LIMIT 1
      `).get(j1.id, j2.id, j2.id, j1.id);

      if (!partido) {
        return interaction.reply('❌ No se encontró un partido entre estos dos jugadores en la base de datos.');
      }

      const usuario1 = db.prepare('SELECT * FROM usuarios WHERE discordId = ?').get(j1.id);
      const usuario2 = db.prepare('SELECT * FROM usuarios WHERE discordId = ?').get(j2.id);

      if (!usuario1 || !usuario2) {
        return interaction.reply('❌ Falta información de ELO para uno o ambos jugadores.');
      }

      const nombre1 = usuario1.nombre || j1.username;
      const nombre2 = usuario2.nombre || j2.username;

      // Buscar el ELO de inscripción en el torneo del partido
      let elo1, elo2, fuenteElo;
      if (partido.torneo_id) {
        const insc1 = db.prepare('SELECT elo_inscripcion FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(partido.torneo_id, j1.id);
        const insc2 = db.prepare('SELECT elo_inscripcion FROM inscripciones WHERE torneo_id = ? AND usuario_id = ?').get(partido.torneo_id, j2.id);
        if (insc1?.elo_inscripcion && insc2?.elo_inscripcion) {
          elo1 = Number(insc1.elo_inscripcion);
          elo2 = Number(insc2.elo_inscripcion);
          fuenteElo = 'inscripción';
        }
      }
      if (elo1 === undefined || elo2 === undefined) {
        elo1 = Number(usuario1.elo || 0);
        elo2 = Number(usuario2.elo || 0);
        fuenteElo = 'actual';
      }
      const diferencia = Math.abs(elo1 - elo2);

      let handicap = 0;
      if (diferencia >= 150) {
        if (diferencia >= 1050) handicap = 35;
        else if (diferencia >= 900) handicap = 30;
        else if (diferencia >= 750) handicap = 25;
        else if (diferencia >= 600) handicap = 20;
        else if (diferencia >= 450) handicap = 15;
        else if (diferencia >= 300) handicap = 10;
        else handicap = 5;
      }

      const favorecido = elo1 < elo2 ? nombre1 : nombre2;
      const torneoNombre = partido.torneo_nombre || 'torneo';
      const fase = partido.fase ? `Fase: ${partido.fase}` : 'Fase: desconocida';
      const grupo = partido.grupo_id ? `Grupo ID: ${partido.grupo_id}` : '';

      const eloLabel = fuenteElo === 'inscripción' ? 'ELO inscripción' : 'ELO actual';
      let respuesta = `⚔️ **PREPARACIÓN DE DUELO** ⚔️\n\n` +
                      `Torneo: **${torneoNombre}**\n` +
                      `${fase}${grupo ? ` · ${grupo}` : ''}\n\n` +
                      `👤 **${nombre1}** (${elo1} ${eloLabel})\n` +
                      `👤 **${nombre2}** (${elo2} ${eloLabel})\n` +
                      `📊 Diferencia: **${diferencia} pts**\n\n`;

      if (handicap > 0) {
        respuesta += `⚖️ **Hándicap recomendado:**\n` +
                     `El jugador **${favorecido}** recibe un **${handicap}%**.`;
      } else {
        respuesta += `⚖️ **Duelo equilibrado:** Sin hándicap (diferencia menor a 150 pts).`;
      }

      await interaction.reply(respuesta);
    } catch (error) {
      console.error('Error comando duelo:', error);
      await interaction.reply('❌ Ocurrió un error consultando el duelo.');
    } finally {
      db.close();
    }
  }
};