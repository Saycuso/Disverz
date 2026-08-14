import { Client } from 'discord.js';
import { prisma } from '../../lib/prisma.js'; // adjust path to match your structure

export function registerGuildUpdate(client: Client) {
  client.on('guildUpdate', async (oldGuild, newGuild) => {
    // Only fire database query if the icon or name actually changed
    const nameChanged = oldGuild.name !== newGuild.name;
    const iconChanged = oldGuild.icon !== newGuild.icon;

    if (!nameChanged && !iconChanged) return;

    try {
      // 👑 Format the new icon URL (supports animated GIFs and static PNGs)
      const newIconUrl = newGuild.icon
        ? `https://cdn.discordapp.com/icons/${newGuild.id}/${newGuild.icon}.png`
        : null;

      // Update only if this server is registered in Disverz
      const updated = await prisma.server.updateMany({
        where: { discordId: newGuild.id },
        data: {
          name: newGuild.name,
          iconUrl: newIconUrl,
        },
      });

      if (updated.count > 0) {
        console.log(`[SYNC] ✅ Auto-updated profile for: ${newGuild.name} (Icon: ${iconChanged}, Name: ${nameChanged})`);
      }
    } catch (error) {
      console.error(`[SYNC ERROR] Failed to sync guildUpdate for ${newGuild.id}:`, error);
    }
  });
}