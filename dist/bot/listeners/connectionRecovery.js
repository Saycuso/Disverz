import { Events } from "discord.js";
import { prisma } from "../../lib/prisma.js";
export function startConnectionRecovery(client, recovery) {
    const queued = new Map();
    let scanning = false;
    function schedule(guildId) {
        if (!client.isReady())
            return;
        const previous = queued.get(guildId);
        if (previous) {
            clearTimeout(previous);
        }
        // Let Discord finish creating the channel and
        // setting its permission overwrites.
        const timer = setTimeout(() => {
            queued.delete(guildId);
            void (async () => {
                const server = await prisma.server.findUnique({
                    where: { discordId: guildId },
                });
                if (!server?.isClaimed || server.isPublicIndex) {
                    return;
                }
                recovery.invalidate(server.id);
                await recovery.ensure(server.id);
            })().catch((error) => {
                console.error(`[CONNECTION] Event recovery failed for ${guildId}:`, error);
            });
        }, 1_500);
        timer.unref();
        queued.set(guildId, timer);
    }
    client.on(Events.ChannelDelete, (channel) => {
        if ("guild" in channel) {
            schedule(channel.guild.id);
        }
    });
    client.on(Events.ChannelCreate, (channel) => {
        if ("guild" in channel) {
            schedule(channel.guild.id);
        }
    });
    client.on(Events.ChannelUpdate, (_, channel) => {
        if ("guild" in channel) {
            schedule(channel.guild.id);
        }
    });
    client.on(Events.GuildCreate, (guild) => {
        schedule(guild.id);
    });
    client.on(Events.GuildUpdate, (_, guild) => {
        schedule(guild.id);
    });
    client.on(Events.GuildRoleUpdate, (_, role) => {
        schedule(role.guild.id);
    });
    client.on(Events.GuildRoleDelete, (role) => {
        schedule(role.guild.id);
    });
    client.on(Events.GuildMemberUpdate, (_, member) => {
        if (member.id === client.user?.id) {
            schedule(member.guild.id);
        }
    });
    async function scan() {
        if (scanning || !client.isReady())
            return;
        scanning = true;
        try {
            const servers = await prisma.server.findMany({
                where: {
                    isClaimed: true,
                    isPublicIndex: false,
                },
                select: {
                    id: true,
                    discordId: true,
                },
            });
            for (const server of servers) {
                if (!client.guilds.cache.has(server.discordId)) {
                    continue;
                }
                try {
                    await recovery.ensure(server.id);
                }
                catch (error) {
                    console.error(`[CONNECTION] Recovery failed for ${server.discordId}:`, error);
                }
            }
        }
        catch (error) {
            console.error("[CONNECTION] Recovery scan failed:", error);
        }
        finally {
            scanning = false;
        }
    }
    // Recover changes that happened while the bot was offline.
    void scan();
    const timer = setInterval(() => {
        void scan();
    }, 5 * 60_000);
    timer.unref();
}
//# sourceMappingURL=connectionRecovery.js.map