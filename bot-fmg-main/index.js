const path = require('path');
const Database = require('better-sqlite3');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ActivityType
} = require('discord.js');

const { client } = require('./discordClient');
const { obtenerEloActual } = require('../lib/aoe2');
const { actualizarYPublicarRankingClan } = require('./utils/rankingClan');

const ROL_ACCESO_ID = process.env.ROL_ACCESO_ID || '1377760878807613520';
const getDB = () => new Database(path.resolve(process.cwd(), 'botfmg.db'));

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', async (c) => {
  console.log(`🤖 ${c.user.username} online`);
  c.user.setActivity('Age of Empires II', { type: ActivityType.Playing });

  const servidores = Object.keys(require('./botConfig.json').servidores || {});
  for (const guildId of servidores) {
    await actualizarYPublicarRankingClan(c, guildId);
  }

  setInterval(() => {
    const servidores = Object.keys(require('./botConfig.json').servidores || {});
    for (const guildId of servidores) {
      actualizarYPublicarRankingClan(c, guildId).catch(() => {});
    }
  }, 7 * 24 * 60 * 60 * 1000);
});

// ── Bienvenida ────────────────────────────────────────────────────────────────
client.on('guildMemberAdd', async (member) => {
  const config = require('./bienvenidaConfig.json');
  const channelId = config[member.guild.id];
  if (!channelId) return;

  const embed = new EmbedBuilder()
    .setColor('#c8a840')
    .setTitle(`¡Bienvenido, ${member.user.username}!`)
    .setDescription('Para acceder a todos los canales, vinculá tu perfil de AoE2 Companion.')
    .addFields(
      { name: 'Paso 1', value: 'Buscá tu perfil en [AoE2 Companion](https://www.aoe2companion.com/)', inline: false },
      { name: 'Paso 2', value: 'Presioná el botón de abajo y pegá el link de tu perfil.', inline: false }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_modal_vincular')
      .setLabel('🛡️ Vincular Perfil y Entrar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('Buscar mi perfil')
      .setStyle(ButtonStyle.Link)
      .setURL('https://www.aoe2companion.com/')
  );

  const channel = member.guild.channels.cache.get(channelId)
    || await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  await channel.send({
    content: `¡Hola ${member}! 🏰 Bienvenido a la comunidad.`,
    embeds: [embed],
    components: [row]
  });
});

// ── Interacciones ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'vincular') return await handleVincular(interaction);
      if (interaction.commandName === 'duelo')    return await handleDuelo(interaction);
      return;
    }

    // Botón → abrir modal vincular
    if (interaction.isButton() && interaction.customId === 'abrir_modal_vincular') {
      const modal = new ModalBuilder()
        .setCustomId('modal_vincular_aoe2')
        .setTitle('Vincular Cuenta AoE2');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('aoe2_url_input')
            .setLabel('URL de tu perfil de AoE2 Companion')
            .setPlaceholder('https://www.aoe2companion.com/players/2583756566')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }

    // Modal submit → vincular
    if (interaction.isModalSubmit() && interaction.customId === 'modal_vincular_aoe2') {
      const url = interaction.fields.getTextInputValue('aoe2_url_input');
      const match = url.match(/^https?:\/\/(www\.)?aoe2companion\.com\/players\/(\d+)/);
      if (!match) return interaction.reply({ content: '❌ URL no válida. Ejemplo: `https://www.aoe2companion.com/players/2304739`', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      return await guardarVinculacion(interaction, match[2]);
    }
  } catch (err) {
    console.error('[Bot] Error en interacción:', err);
    const reply = { content: '❌ Error interno. Intentá nuevamente.', ephemeral: true };
    interaction.deferred || interaction.replied
      ? interaction.followUp(reply).catch(() => {})
      : interaction.reply(reply).catch(() => {});
  }
});

// ── /vincular (slash directo) ─────────────────────────────────────────────────
async function handleVincular(interaction) {
  const url = interaction.options.getString('aoe2id');
  const match = url.match(/^https?:\/\/(www\.)?aoe2companion\.com\/players\/(\d+)/);
  if (!match) {
    return interaction.reply({
      content: '❌ URL no válida.\nEjemplo: `https://www.aoe2companion.com/players/2304739`',
      ephemeral: true
    });
  }
  await interaction.deferReply({ ephemeral: true });
  await guardarVinculacion(interaction, match[2]);
}

// ── Lógica compartida de vinculación ─────────────────────────────────────────
async function guardarVinculacion(interaction, profileId) {
  const datos = await obtenerEloActual(profileId);
  if (!datos || datos.error) {
    const mensaje = datos?.error === 'no_1v1_rank'
      ? '❌ No se encontraron partidas rankeadas 1v1 para este perfil. Asegurate de tener partidas rankeadas 1v1 en AoE2 Companion.'
      : '❌ No se pudo obtener el perfil. Intentá más tarde o verificá que el link sea correcto.';
    return interaction.editReply({ content: mensaje });
  }

  const db = getDB();
  try {
    db.prepare(`
      INSERT INTO usuarios
        (discordId, profileId, nombre, elo, rank, wins, losses, pais, country, clan, elomax, ultimapartida, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(discordId) DO UPDATE SET
        profileId    = excluded.profileId,
        nombre       = excluded.nombre,
        elo          = excluded.elo,
        rank         = excluded.rank,
        wins         = excluded.wins,
        losses       = excluded.losses,
        pais         = excluded.pais,
        country      = excluded.country,
        clan         = excluded.clan,
        elomax       = CASE WHEN excluded.elo > elomax THEN excluded.elo ELSE elomax END,
        ultimapartida= excluded.ultimapartida,
        data         = excluded.data
    `).run(
      interaction.user.id,
      profileId,
      datos.nombre,
      datos.elo,
      datos.rank,
      datos.wins,
      datos.losses,
      datos.pais   || null,
      datos.country|| null,
      datos.clan   || null,
      datos.elomax || datos.elo,
      datos.ultimapartida || null,
      datos.fullData || '{}'
    );
  } finally {
    db.close();
  }

  // Asignar rol de acceso
  try {
    const role = interaction.guild?.roles.cache.get(ROL_ACCESO_ID);
    if (role && interaction.member) await interaction.member.roles.add(role);
  } catch (e) {
    console.error('[Bot] Error asignando rol:', e.message);
  }

  await interaction.editReply({
    content: `✅ Vinculado como **${datos.nombre}** (ELO ${datos.elo}). ¡Acceso concedido!`
  });
}

// ── /duelo ────────────────────────────────────────────────────────────────────
async function handleDuelo(interaction) {
  const j1 = interaction.options.getUser('jugador1');
  const j2 = interaction.options.getUser('jugador2');

  const db = getDB();
  let u1, u2;
  try {
    u1 = db.prepare('SELECT nombre, elo FROM usuarios WHERE discordId = ?').get(j1.id);
    u2 = db.prepare('SELECT nombre, elo FROM usuarios WHERE discordId = ?').get(j2.id);
  } finally {
    db.close();
  }

  if (!u1 || !u2) {
    const falta = !u1 ? j1.username : j2.username;
    return interaction.reply({
      content: `❌ **${falta}** no está vinculado. Debe usar /vincular primero.`,
      ephemeral: true
    });
  }

  const diferencia = Math.abs(u1.elo - u2.elo);
  let handicap = 0;
  if      (diferencia >= 1050) handicap = 35;
  else if (diferencia >=  900) handicap = 30;
  else if (diferencia >=  750) handicap = 25;
  else if (diferencia >=  600) handicap = 20;
  else if (diferencia >=  450) handicap = 15;
  else if (diferencia >=  300) handicap = 10;
  else if (diferencia >=  150) handicap =  5;

  const favorecido = u1.elo < u2.elo ? u1.nombre : u2.nombre;

  let msg = `⚔️ **DUELO**\n\n`
    + `👤 **${u1.nombre}** — ${u1.elo} ELO\n`
    + `👤 **${u2.nombre}** — ${u2.elo} ELO\n`
    + `📊 Diferencia: **${diferencia} pts**\n\n`;

  msg += handicap > 0
    ? `⚖️ **${favorecido}** recibe un hándicap de **${handicap}%**.`
    : `⚖️ Duelo equilibrado — sin hándicap (diferencia < 150 pts).`;

  await interaction.reply(msg);
}
