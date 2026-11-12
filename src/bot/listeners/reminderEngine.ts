import {
  ChannelType,
  EmbedBuilder,
  type Client,
} from "discord.js";
import { prisma } from "../../lib/prisma.js";
import {
  discordErrorCode,
  type ConnectionRecovery,
} from "../services/connectionRecovery.js";

export function createReminderRunner(
  client: Client,
  recovery: ConnectionRecovery,
  database = prisma,
) {
  let running = false;

  return async function runReminders() {
    if (running || !client.isReady()) return;

    running = true;

    try {
      const bumpCooldown = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      );

      const servers = await database.server.findMany({
        where: {
          isClaimed: true,
          isPublicIndex: false,
          bumpReminders: true,
          reminderSent: false,

          // Missing channels also get a recovery attempt.
          OR: [
            { lastChallengeAt: { lt: bumpCooldown } },
            { lastChallengeAt: null },
          ],
        },
      });

      for (const server of servers) {
        try {
          const connection = await recovery.ensure(
            server.id,
          );

          if (!connection.reminderChannelId) {
            continue;
          }

          // Settings may have changed while recovery ran.
          const current =
            await database.server.findUnique({
              where: { id: server.id },
            });

          if (
            !current?.bumpReminders ||
            current.reminderSent ||
            current.challengeChannelId !==
              connection.reminderChannelId ||
            (current.lastChallengeAt &&
              current.lastChallengeAt >= bumpCooldown)
          ) {
            continue;
          }

          const channel = await client.channels.fetch(
            connection.reminderChannelId,
            { force: true },
          );

          if (
            !channel ||
            !(
              channel.type === ChannelType.GuildText ||
              channel.type ===
                ChannelType.GuildAnnouncement
            ) ||
            channel.guild.id !== server.discordId
          ) {
            recovery.invalidate(server.id);
            continue;
          }

          const embed = new EmbedBuilder()
            .setColor("#ff5500")
            .setTitle("⚠️ Time to Pulse!")
            .setDescription(
              "Your server is dropping in the Disverz rankings! " +
                "Use `/bump` to refresh your pulse and climb back to the top.",
            )
            .setFooter({
              text: "Disverz Network",
            });

          const avatar =
            client.user?.displayAvatarURL();

          if (avatar) {
            embed.setFooter({
              text: "Disverz Network",
              iconURL: avatar,
            });
          }

          await channel.send({
            embeds: [embed],
            allowedMentions: { parse: [] },
          });

          // Mark only the bump we actually reminded about.
          // A new bump during the send keeps its future reminder.
          await database.server.updateMany({
            where: {
              id: current.id,
              bumpReminders: true,
              reminderSent: false,
              challengeChannelId:
                connection.reminderChannelId,
              lastChallengeAt: current.lastChallengeAt,
            },
            data: {
              reminderSent: true,
            },
          });

          console.log(
            `[REMINDER ENGINE] Sent bump reminder to ${server.name}`,
          );
        } catch (error) {
          const code = discordErrorCode(error);

          recovery.invalidate(server.id);

          console.error(
            `[REMINDER ENGINE] Send failed for ${server.name}; ` +
              `will recheck before retrying (${code ?? "UNKNOWN"}).`,
          );
        }
      }
    } catch (error) {
      console.error(
        "[REMINDER ENGINE] Cycle failed:",
        error,
      );
    } finally {
      running = false;
    }
  };
}

export function startReminderEngine(
  client: Client,
  recovery: ConnectionRecovery,
) {
  console.log("⏰ Reminder Engine started...");

  const run = createReminderRunner(client, recovery);

  const timer = setInterval(() => {
    void run();
  }, 5 * 60_000);

  timer.unref();
}