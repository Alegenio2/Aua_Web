// comandos/vincular.js
const { ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const botConfig = require('../botConfig.json');
const Database = require('better-sqlite3');
const path = require('path');
const { obtenerEloActual } = require('../utils/elo');
const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

module.exports = {
  name: 'vincular',
  description: 'Vincula tu cuenta de Discord con tu perfil de AoE2 Companion.',
  options: [
    {
      name: 'aoe2id',
      description: 'Link de tu perfil de aoe2companion.',
      type: ApplicationCommandOptionType.String,
      required: true,
    },
  ],

  async execute(interaction) {
    const { user, options, guildId, channelId, member, guild } = interaction;
    const configServidor = botConfig.servidores[guildId];
    const canalVincular = configServidor?.canalVincular;
    const ROL_ACCESO_ID = '1377760878807613520'; // <--- Tu ID de rol de acceso

    // 🔒 Validar canal
    if (!canalVincular || channelId !== canalVincular) {
      return interaction.reply({
        content: "⚠️ Este comando solo se puede usar en el canal de vinculación correspondiente.",
        ephemeral: true
      });
    }

    // ⏳ Diferir respuesta (importante para evitar timeouts de la API de AoE)
    await interaction.deferReply({ ephemeral: true });

    // 🔗 Validar URL
    const urlCompleta = options.getString('aoe2id');
    const match = urlCompleta.match(/^https:\/\/(www\.)?aoe2companion\.com\/players\/(\d+)$/);

    if (!match) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Buscar tu perfil en AoE2 Companion")
          .setStyle(ButtonStyle.Link)
          .setURL("https://www.aoe2companion.com/")
      );

      return interaction.editReply({
        content: "❌ La URL no es válida.\nEjemplo:\n`https://www.aoe2companion.com/players/2304739`",
        components: [row]
      });
    }

    const profileId = match[2];

    // 🔍 Obtener datos reales del jugador
    const datos = await obtenerEloActual(profileId);

    if (!datos || datos.error) {
      const mensaje = datos?.error === 'no_1v1_rank'
        ? '❌ No se encontraron partidas rankeadas 1v1 para este perfil. Asegurate de haber jugado partidas rankeadas 1v1 recientemente.'
        : '❌ No se pudieron obtener los datos del perfil. Verificá el ID o intentá más tarde.';
      return interaction.editReply({ content: mensaje });
    }

    // 🧠 Construir objeto usuario
    const usuario = {
      profileId,
      nombre: datos.nombre,
      elo: datos.elo,
      rank: datos.rank,
      wins: datos.wins,
      losses: datos.losses,
      pais: datos.pais,
      country: datos.country,
      clan: datos.clan,
      elomax: datos.elomax,
      ultimapartida: datos.ultimapartida
    };

    // 💾 Guardar en la base de datos SQLite
    const db = getDB();
    try {
      db.prepare(`
        INSERT OR REPLACE INTO usuarios (discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, elomax, ultimapartida, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id, profileId, datos.nombre,
        datos.elo || 0, datos.rank || 0,
        datos.wins || 0, datos.losses || 0,
        datos.pais || '🇺🇾', datos.country || 'uy',
        datos.clan || '', datos.elomax || datos.elo || 0,
        new Date().toISOString(), JSON.stringify(datos)
      );
    } catch (e) {
      console.error('Error guardando vinculo en BD:', e.message);
      return interaction.editReply({ content: '❌ Error guardando la vinculación en la base de datos.' });
    } finally {
      db.close();
    }

    // 🎭 ASIGNAR ROL DE ACCESO
    try {
      if (member) {
        const rolAcceso = guild.roles.cache.get(ROL_ACCESO_ID);
        if (rolAcceso) {
          await member.roles.add(rolAcceso);
        } else {
          console.error("⚠️ El rol de acceso no existe en el servidor.");
        }
      }
    } catch (error) {
      console.error("❌ Error al asignar el rol de acceso:", error);
      // No cortamos el flujo aquí porque la vinculación ya se guardó
    }

    return interaction.editReply({
      content: `✅ Tu cuenta fue vinculada correctamente con **${usuario.nombre}** (ELO ${usuario.elo}).\n🔓 **Se te ha otorgado acceso al servidor.**`
    });
  }
};
