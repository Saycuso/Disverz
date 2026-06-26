import { Client, TextChannel } from 'discord.js';
import { prisma } from '../lib/prisma.js';

// --- TEST MODE THRESHOLDS ---
const CHECK_INTERVAL_MS = 15 * 1000; 
const COOLDOWN_MINUTES = 1;          

export function startChallengeScheduler(client: Client) {
    setInterval(async () => {
        try {
            const cooldownCutoff = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000);

            // 1. DB-Level Filtering: Only fetch servers ACTUALLY eligible right now
            const eligibleServers = await prisma.server.findMany({
                where: {
                    isDormant: false,
                    OR: [
                        { lastChallengeAt: null },
                        { lastChallengeAt: { lt: cooldownCutoff } }
                    ]
                }
            });

            if (eligibleServers.length === 0) return;

            // 2. Controlled Concurrency (Batching)
            const BATCH_SIZE = 20;
            for (let i = 0; i < eligibleServers.length; i += BATCH_SIZE) {
                const batch = eligibleServers.slice(i, i + BATCH_SIZE);
                // Process the batch of 20 concurrently, wait for them to finish, then do the next 20
                await Promise.allSettled(batch.map(server => fireChallenge(client, server)));
            }

        } catch (error) {
            console.error('Challenge Scheduler Error:', error);
        }
    }, CHECK_INTERVAL_MS);

    console.log('[SCHEDULER] Batched Trivia Cannon is armed and running...');
}

// 3. The Isolated Payload Function
async function fireChallenge(client: Client, server: any) {
    try {
        // Raw SQL for scalable randomness
        const randomQuestion = await prisma.$queryRaw<Array<{id: string, category: string, text: string, answer: string}>>`
          SELECT * FROM "Question"
          WHERE category = ${server.category}
          ORDER BY RANDOM()
          LIMIT 1
        `;
        
        const question = randomQuestion[0];
        if (!question) return;

        const guild = client.guilds.cache.get(server.discordId);
        if (!guild) return;

        const channel = guild.systemChannel || guild.channels.cache.find(c =>
            c.isTextBased() && guild.members.me && c.permissionsFor(guild.members.me).has('SendMessages')
        ) as TextChannel;
        
        if (!channel) return;

        await channel.send(
            `🚨 **DISVERZ VITALS CHALLENGE** 🚨\n\n**Category:** ${question.category.toUpperCase()}\n\n**${question.text}**\n\n*The first human to reply with the exact correct answer secures the pulse and increases the server's rank.*`
        );

        await prisma.$transaction([
            prisma.challenge.create({
                data: { serverId: server.id, questionId: question.id }
            }),
            prisma.server.update({
                where: { id: server.id },
                data: { lastChallengeAt: new Date() }
            })
        ]);

        console.log(`[SCHEDULER] Fired challenge into: ${server.name}`);
    } catch (err) {
        console.error(`[SCHEDULER] Failed for ${server.name}:`, err);
    }
}