import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { prisma } from "../../lib/prisma.js";// 👑 Adjust path to wherever your Prisma instance is

export const data = new SlashCommandBuilder()
  .setName("reminders")
  .setDescription("Turn bump reminders ON or OFF for this server.")
  // 👑 SECURITY: Only people with "Manage Server" permissions can see/use this
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption(option =>
    option.setName("active")
      .setDescription("Set to True to turn reminders ON, False to turn them OFF.")
      .setRequired(true)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId) return;

  const isActive = interaction.options.getBoolean("active", true);

  try {
    // 👑 Acknowledge the command quickly so Discord doesn't timeout
    await interaction.deferReply({ ephemeral: true });

    // 👑 Update PostgreSQL directly from the bot
    await prisma.server.update({
      where: { discordId: interaction.guildId },
      data: { bumpReminders: isActive },
    });

    await interaction.editReply(
      `✅ Bump reminders have been turned **${isActive ? 'ON' : 'OFF'}**. (This is synced with your web dashboard!)`
    );
  } catch (error) {
    console.error("Error toggling reminders via slash command:", error);
    await interaction.editReply(
      "❌ Failed to update settings. Make sure this server is registered on the Disverz dashboard first."
    );
  }
};