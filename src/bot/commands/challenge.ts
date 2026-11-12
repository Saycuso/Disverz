import { CommandInteraction, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js'; 
import { SlashCommandBuilder } from '@discordjs/builders'; 
import { prisma } from '../../lib/prisma.js'; 

// 1. The Zero-DB Object Pool (You can add as many of these as you want!)
const objectPool = [
    { word: "burger", emoji: "🍔" },
    { word: "car", emoji: "🚗" },
    { word: "guitar", emoji: "🎸" },
    { word: "soccer ball", emoji: "⚽" },
    { word: "pizza", emoji: "🍕" },
    { word: "laptop", emoji: "💻" },
    { word: "basketball", emoji: "🏀" },
    { word: "cactus", emoji: "🌵" },
    { word: "rocket", emoji: "🚀" },
    { word: "crown", emoji: "👑" }
];

export const data = new SlashCommandBuilder()
    .setName('bump')
    .setDescription('Prove you are human to bump this server to the top of Disverz!'); 

export async function execute(interaction: CommandInteraction) { 
    const guildId = interaction.guildId; 
    const channel = interaction.channel as TextChannel; 

    if (!guildId || !channel) { 
        await interaction.reply({ content: 'This command only works inside a server text channel.', ephemeral: true }); 
        return; 
    } 

    // 2. Target Acquisition 
    const server = await prisma.server.findUnique({ where: { discordId: guildId } }); 
    if (!server) { 
        await interaction.reply({ content: '❌ This server is not registered. The owner must list it on disverz.com first.', ephemeral: true }); 
        return; 
    } 

    // 3. Cooldown Strategy 
    const COOLDOWN_HOURS = 2; 
    if (server.lastChallengeAt) { 
        const hoursSinceLast = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60); 
        if (hoursSinceLast < COOLDOWN_HOURS) { 
            const minutesLeft = Math.ceil((COOLDOWN_HOURS - hoursSinceLast) * 60); 
            await interaction.reply({ content: `⏳ The engine is cooling down. Next bump available in **${minutesLeft} minutes**.`, ephemeral: true }); 
            return; 
        } 
    } 

    // 4. Generate the Mini-Game (In-Memory, Zero DB!)
    // Shuffle the pool and pick 4 items
    const shuffledPool = [...objectPool].sort(() => 0.5 - Math.random());
    const options = shuffledPool.slice(0, 4);
    
    // Pick 1 as the correct answer
    const randomIndex = Math.floor(Math.random() * options.length);
    const correctTarget = options[randomIndex]!;
    
    // Generate secure, random IDs for the buttons so bots can't guess them
    const correctId = `btn_correct_${Date.now()}`;
    const row = new ActionRowBuilder<ButtonBuilder>();

    options.forEach((opt, index) => {
        const isCorrect = opt.word === correctTarget.word;
        const customId = isCorrect ? correctId : `btn_wrong_${Date.now()}_${index}`;
        
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setEmoji(opt.emoji)
                .setStyle(ButtonStyle.Secondary)
        );
    });

    // 5. Deploy the Ephemeral Challenge
    const startTime = Date.now();
    const response = await interaction.reply({ 
        content: `### 🛡️ Disverz Human Check\nClick the **${correctTarget.word}** button to instantly bump this server!`, 
        components: [row],
        ephemeral: true, // Only the user who typed the command can see this!
        withResponse: true 
    }); 

    // 6. The Button Collector 
    const message = response.resource?.message;
    if (!message) return;

    // Give them exactly 15 seconds to click a button
    const collector = message.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 15 * 1000 
    }); 

    collector.on('collect', async (btnInteraction) => {
    // Stop accepting clicks before any asynchronous work starts.
    collector.stop('submitted');

    const responseTimeMs = Date.now() - startTime;
    let bumpSaved = false;

    try {
        // Acknowledge the click before waiting for the database.
        await btnInteraction.deferUpdate();

        if (responseTimeMs < 800) {
            await btnInteraction.editReply({
                content: '⚡ You clicked too quickly. Please try again.',
                components: []
            });
            return;
        }

        const accountAgeMs =
            Date.now() - btnInteraction.user.createdTimestamp;

        if (accountAgeMs < 7 * 24 * 60 * 60 * 1000) {
            await btnInteraction.editReply({
                content: '🛑 Your Discord account must be at least 7 days old.',
                components: []
            });
            return;
        }

        if (btnInteraction.customId !== correctId) {
            await btnInteraction.editReply({
                content: '❌ **INCORRECT!** You clicked the wrong emoji. Bump failed.',
                components: []
            });
            return;
        }

        await prisma.server.update({
            where: { id: server.id },
            data: {
                lastChallengeAt: new Date(),
                lastHumanMsgAt: new Date(),
                isDormant: false,
                reminderSent: false
            }
        });

        bumpSaved = true;

        await btnInteraction.editReply({
            content: `🔥 **VICTORY!** You correctly clicked ${correctTarget.emoji} in ${(responseTimeMs / 1000).toFixed(1)}s!`,
            components: []
        });

        // The bump is already saved. An announcement failure
        // must not turn it into a failed bump or crash the backend.
        try {
            await channel.send({
                content: `🚀 **${btnInteraction.user.username}** just proved they are human and bumped this server to the top of Disverz!`,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            console.error(
                `[BUMP] Bump saved, but announcement failed in channel ${channel.id}:`,
                error
            );
        }
    } catch (error) {
        console.error(
            `[BUMP] Challenge handler failed for guild ${guildId}:`,
            error
        );

        // Sending the error response can also fail, so handle that too.
        try {
            await interaction.editReply({
                content: bumpSaved
                    ? '✅ Your bump was saved, but the confirmation could not be completed.'
                    : '❌ The bump could not be confirmed. Please try again shortly.',
                components: []
            });
        } catch (replyError) {
            console.error(
                '[BUMP] Could not update the challenge message:',
                replyError
            );
        }
    }
});

collector.on('end', async (_, reason) => {
    if (reason !== 'time') return;

    try {
        await interaction.editReply({
            content: '⏰ The human check has expired. You took too long to click!',
            components: []
        });
    } catch (error) {
        console.error(
            `[BUMP] Could not update expired challenge for guild ${guildId}:`,
            error
        );
    }
});
}