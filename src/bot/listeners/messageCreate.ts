import { Client } from 'discord.js';
import { prisma } from '../../lib/prisma.js'// adjust path to match your structure

export function registerMessageCreate(client: Client) {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guildId) return;

    try {
      const server = await prisma.server.findUnique({
        where: { discordId: message.guildId }
      });

      if (!server) return;

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      if (!server.lastHumanMsgAt || server.lastHumanMsgAt < fiveMinutesAgo) {
        await prisma.server.update({
          where: { discordId: message.guildId },
          data: {
            lastHumanMsgAt: new Date(),
            isDormant: false
          }
        });
      }
    } catch (error) {
      console.error('Vitals Tracking Error:', error);
    }
  });
}