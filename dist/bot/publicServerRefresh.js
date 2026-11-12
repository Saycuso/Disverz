import { prisma } from "../lib/prisma.js";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
export async function refreshPublicServers() {
    const cutoff = new Date(Date.now() - THREE_DAYS_MS);
    const servers = await prisma.server.findMany({
        where: {
            isPublicIndex: true,
            isClaimed: false,
            OR: [
                { publicStatsCheckedAt: null },
                { publicStatsCheckedAt: { lte: cutoff } },
            ],
        },
        select: {
            id: true,
            discordId: true,
            inviteLink: true,
            memberCount: true,
        },
    });
    console.log(`${servers.length} public servers need a count refresh.`);
    for (const server of servers) {
        try {
            const inviteUrl = new URL(server.inviteLink);
            const inviteCode = inviteUrl.pathname.split("/").filter(Boolean).pop();
            if (!inviteCode)
                continue;
            const response = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`, { signal: AbortSignal.timeout(10000) });
            if (response.status === 429) {
                console.warn("Discord rate limit reached. Pausing this refresh run.");
                return;
            }
            if (!response.ok)
                continue;
            const data = await response.json();
            const count = data.approximate_member_count;
            if (data.guild?.id !== server.discordId ||
                !Number.isInteger(count) ||
                count < 0) {
                continue;
            }
            await prisma.server.update({
                where: { id: server.id },
                data: {
                    memberCount: count,
                    publicStatsCheckedAt: new Date(),
                },
            });
            console.log(`Updated ${server.discordId}: ${count} members`);
        }
        catch (error) {
            console.error(`Count refresh failed for ${server.discordId}:`, error);
        }
        finally {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}
let refreshRunning = false;
let refreshStarted = false;
export function startPublicServerRefresh() {
    if (refreshStarted)
        return;
    refreshStarted = true;
    const runRefresh = async () => {
        if (refreshRunning)
            return;
        refreshRunning = true;
        try {
            await refreshPublicServers();
        }
        catch (error) {
            console.error("Public server refresh failed:", error);
        }
        finally {
            refreshRunning = false;
        }
    };
    void runRefresh();
    setInterval(() => {
        void runRefresh();
    }, 60 * 60 * 1000);
}
//# sourceMappingURL=publicServerRefresh.js.map