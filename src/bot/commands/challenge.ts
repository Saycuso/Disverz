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
    const COOLDOWN_HOURS = 0; 
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
        // --- ANTI-ABUSE SHIELD --- 
        const responseTimeMs = Date.now() - startTime; 
        if (responseTimeMs < 800) { // 800ms human reaction threshold
            await btnInteraction.reply({ content: `⚡ **BEEP BOOP.** You clicked faster than humanly possible. Script detected. Bump burned.`, ephemeral: true }); 
            collector.stop('busted'); 
            return; 
        } 

        const accountAgeMs = Date.now() - btnInteraction.user.createdTimestamp; 
        if (accountAgeMs < (7 * 24 * 60 * 60 * 1000)) { 
            await btnInteraction.reply({ content: `🛑 **ACCESS DENIED.** Only veteran Discord accounts (7+ days old) can secure the bump.`, ephemeral: true }); 
            collector.stop('busted');
            return; 
        } 

        // --- WIN / LOSE CONDITIONS --- 
        if (btnInteraction.customId === correctId) {
            // They clicked the right button! Update Neon DB.
            await prisma.server.update({ 
                where: { id: server.id }, 
                data: { 
                    lastChallengeAt: new Date(), 
                    lastHumanMsgAt: new Date(), 
                    isDormant: false, 
                    reminderSent: false // Resets the alarm clock!
                } 
            }); 

            // Edit their ephemeral message to show success and remove buttons
            await btnInteraction.update({
                content: `🔥 **VICTORY!** You correctly clicked ${correctTarget.emoji} in ${(responseTimeMs / 1000).toFixed(1)}s!`,
                components: []
            });

            // Send a public hype message to the channel
            await channel.send(`🚀 **${btnInteraction.user.username}** just proved they are human and bumped this server to the top of Disverz!`);
            collector.stop('answered');
        } else {
            // They clicked the wrong button
            await btnInteraction.update({
                content: `❌ **INCORRECT!** You clicked the wrong emoji. Bump failed.`,
                components: []
            });
            collector.stop('failed');
        }
    }); 

    collector.on('end', async (_, reason) => { 
        if (reason === 'time') { 
            // If they took longer than 15 seconds, edit the ephemeral message
            await interaction.editReply({ 
                content: '⏰ The human check has expired. You took too long to click!',
                components: []
            }); 
        } 
    }); 
}