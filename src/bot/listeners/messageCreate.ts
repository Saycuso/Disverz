import { Client } from 'discord.js';
import { prisma } from '../../lib/prisma.js'

// 🛡️ IN-MEMORY CACHE: Stores the timestamp of the last DB update per guild
const lastPulseCache = new Map<string, number>();

export function registerMessageCreate(client: Client) {
  client.on('messageCreate', async (message) => {
    // 1. Filter out bots and non-guild messages instantly
    if (message.author.bot || message.webhookId || message.system || message.applicationId || !message.guildId) return;

    const now = Date.now();
    const guildId = message.guildId;
    const lastUpdate = lastPulseCache.get(guildId) || 0;
    const fiveMinutes = 5 * 60 * 1000;

    // 2. THE SHIELD: If under 5 minutes, exit immediately. ZERO database queries.
    if (now - lastUpdate < fiveMinutes) {
      return; 
    }

    // 3. Update the local memory instantly so concurrent messages don't trigger the DB
    lastPulseCache.set(guildId, now);

    try {
      // 4. We only hit the database once every 5 minutes per active server
      const server = await prisma.server.findUnique({
        where: { discordId: guildId },
        select: { id: true } // Optimization: Only fetch the ID to save bandwidth
      });

      if (!server) {
        // If not registered, remove from memory so it can be checked again if they register later
        lastPulseCache.delete(guildId);
        return;
      }

      await prisma.server.update({
        where: { discordId: guildId },
        data: {
          lastHumanMsgAt: new Date(now),
          isDormant: false,
          memberCount: message.guild?.memberCount ?? 0
        }
      });
      
      console.log(`[DEBUG] ✅ Updated lastHumanMsgAt for ${guildId}`);
    } catch (error) {
      console.error('Vitals Tracking Error:', error);
      // Revert cache if DB failed, so the next message tries again
      lastPulseCache.delete(guildId); 
    }
  });
}