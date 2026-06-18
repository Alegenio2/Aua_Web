// Ejecutar una sola vez para registrar los comandos en Discord:
//   node bot-fmg-main/registrarComandos.js
require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const botConfig = require('./botConfig.json');

const comandos = [
  {
    name: 'vincular',
    description: 'Vincula tu cuenta de Discord con tu perfil de AoE2 Companion.',
    options: [
      {
        name: 'aoe2id',
        description: 'Link de tu perfil en aoe2companion.com',
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: 'duelo',
    description: 'Calcula el hándicap recomendado entre dos jugadores.',
    options: [
      {
        name: 'jugador1',
        description: 'Primer jugador',
        type: ApplicationCommandOptionType.User,
        required: true
      },
      {
        name: 'jugador2',
        description: 'Segundo jugador',
        type: ApplicationCommandOptionType.User,
        required: true
      }
    ]
  }
];

const token = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error('Faltan TOKEN y/o CLIENT_ID en las variables de entorno.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    const servidores = Object.keys(botConfig.servidores);
    for (const guildId of servidores) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: comandos }
      );
      console.log(`✅ Comandos registrados en guild ${guildId}`);
    }
    console.log('Listo. Solo /vincular y /duelo están activos.');
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
})();
