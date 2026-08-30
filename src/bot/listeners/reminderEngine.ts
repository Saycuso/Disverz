import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { prisma } from "../../lib/prisma.js";

export const startReminderEngine = (client: Client) => {
  console.log("⏰ Reminder Engine started...");

  // Run this check every 5 minutes (300,000 ms)
  setInterval(async () => {
    try {
      // 👑 Define your threshold (e.g., 2 hours ago)
      // Change this math to match whatever your cooldown is!
      const bumpCooldown = new Date(Date.now() - 2 * 60 * 60 * 1000); 

      const serversToRemind = await prisma.server.findMany({
        where: {
          bumpReminders: true,       // They want reminders
          reminderSent: false,       // We haven't reminded them yet
          challengeChannelId: { not: null }, // They set up a channel
          OR: [
            { lastChallengeAt: { lt: bumpCooldown } },
            { lastChallengeAt: null }
          ] 
        }
      });

      for (const server of serversToRemind) {
        if (!server.challengeChannelId) continue;

        try {
          // 1. Fetch the channel from Discord
          const channel = await client.channels.fetch(server.challengeChannelId) as TextChannel;
          
          // 2. Build a clean, premium embed
          const reminderEmbed = new EmbedBuilder()
            .setColor("#ff5500")
            .setTitle("⚠️ Time to Pulse!")
            .setDescription(`Your server is dropping in the Disverz rankings! Use \`/bump\` to refresh your pulse and climb back to the top.`)
            .setFooter({ text: "Disverz Network", iconURL: client.user?.displayAvatarURL() ||"" });

          // 3. Send the ping
          await channel.send({ embeds: [reminderEmbed] });

          // 4. Mark as sent in the database so we don't spam them
          await prisma.server.update({
            where: { id: server.id },
            data: { reminderSent: true }
          });

          console.log(`✅ Sent bump reminder to ${server.name}`);
        } catch (discordErr: any) {
          // 👑 THE FIX: Catch the Missing Access Error and auto-disable
          if (discordErr.code === 50001) {
            console.log(`[REMINDER ENGINE] 🚫 Missing access in server: ${server.name}. Auto-disabling reminders.`);
            
            await prisma.server.update({
              where: { id: server.id },
              data: { bumpReminders: false } // Shut it off so we stop trying
            });
          } else {
            // Log other random API errors normally but cleanly
            console.error(`[REMINDER ENGINE] Failed to send to ${server.name} - Error ${discordErr.code || 'UNKNOWN'}: ${discordErr.message || 'Unknown Error'}`);
          }
        }
      }
    } catch (error) {
      console.error("Reminder Engine Error:", error);
    }
  }, 300000); // 5 minutes
};