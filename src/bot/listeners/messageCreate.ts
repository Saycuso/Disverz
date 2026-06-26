import { Client } from 'discord.js';
import { prisma } from '../../lib/prisma.js'// adjust path to match your structure

export function registerMessageCreate(client: Client) {
  client.on('messageCreate', async (message) => {
    console.log(`[DEBUG] From: ${message.author.tag} | Bot: ${message.author.bot} | Guild: ${message.guildId}`); // ADD THIS

    if (message.author.bot) return;
    if (!message.guildId) return;

    try {
      const server = await prisma.server.findUnique({
        where: { discordId: message.guildId }
      });

      console.log(`[DEBUG] Server found: ${server ? server.name : 'NOT FOUND'}`); // ADD THIS

      if (!server) return;

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      console.log(`[DEBUG] lastHumanMsgAt: ${server.lastHumanMsgAt} | fiveMinutesAgo: ${fiveMinutesAgo}`); // ADD THIS

      if (!server.lastHumanMsgAt || server.lastHumanMsgAt < fiveMinutesAgo) {
        await prisma.server.update({
          where: { discordId: message.guildId },
          data: {
            lastHumanMsgAt: new Date(),
            isDormant: false
          }
        });
        console.log(`[DEBUG] ✅ Updated lastHumanMsgAt`); // ADD THIS
      } else {
        console.log(`[DEBUG] ⏳ Skipped — within 5 min debounce window`); // ADD THIS
      }
    } catch (error) {
      console.error('Vitals Tracking Error:', error);
    }
  });
}