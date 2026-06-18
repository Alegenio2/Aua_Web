const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`Discord client ready: ${client.user ? client.user.tag : 'unknown'}`);
});

async function login() {
  if (!TOKEN) {
    console.warn('No DISCORD_TOKEN provided; Discord client will not log in.');
    return;
  }
  try {
    await client.login(TOKEN);
  } catch (err) {
    console.error('Discord login failed:', err);
  }
}

async function waitReady() {
  if (client.user) return;
  await new Promise(resolve => client.once('ready', resolve));
}

/**
 * Notify a channel with a message or embed.
 * `payload` is the same object you'd pass to `channel.send()` (string, { embeds: [...] }, etc).
 */
async function notifyDiscord(channelId, payload) {
  try {
    await waitReady();
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn('notifyDiscord: channel not found', channelId);
      return null;
    }
    return channel.send(payload);
  } catch (err) {
    console.error('notifyDiscord error:', err);
    return null;
  }
}

module.exports = { client, login, notifyDiscord, EmbedBuilder };
