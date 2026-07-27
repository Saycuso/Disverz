import { CommandInteraction, MessageReaction, User, TextChannel } from 'discord.js'; 
import { SlashCommandBuilder } from '@discordjs/builders'; 
import { prisma } from '../../lib/prisma.js'; 

export const data = new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Trigger a Disverz trivia challenge to bump your server.'); 

export async function execute(interaction: CommandInteraction) { 
    const guildId = interaction.guildId; 
    const channel = interaction.channel as TextChannel; 

    if (!guildId || !channel) { 
        await interaction.reply({ content: 'This command only works inside a server text channel.', ephemeral: true }); 
        return; 
    } 

    // 1. Target Acquisition 
    const server = await prisma.server.findUnique({ where: { discordId: guildId } }); 
    if (!server) { 
        await interaction.reply({ content: '❌ This server is not registered. The owner must list it on disverz.com first.', ephemeral: true }); 
        return; 
    } 

    // 2. Cooldown Strategy 
    const COOLDOWN_HOURS = 2; 
    if (server.lastChallengeAt) { 
        const hoursSinceLast = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60); 
        if (hoursSinceLast < COOLDOWN_HOURS) { 
            const minutesLeft = Math.ceil((COOLDOWN_HOURS - hoursSinceLast) * 60); 
            await interaction.reply({ content: `⏳ The blade is resting. Next challenge available in **${minutesLeft} minutes**.`, ephemeral: true }); 
            return; 
        } 
    } 

    // 3. Fetch the Weapon 
    const questions = await prisma.$queryRaw<Array<{ id: string; category: string; text: string; answer: string; }>>` 
        SELECT * FROM "Question" WHERE category = ${server.category} ORDER BY RANDOM() LIMIT 1 
    `; 
    const question = questions[0]; // 🛠️ FIXED: Added index [0] so it grabs the actual object, not the array
    if (!question) { 
        await interaction.reply({ content: '❌ No questions found for this category.', ephemeral: true }); 
        return; 
    } 

    // 4. The Parser 
    const parts = question.text.split('|'); 
    let displayMessage = `❓ **${question.text}**`; 
    if (parts.length === 5) { 
        const [actualQuestion, optA, optB, optC, optD] = parts; 
        displayMessage = `❓ **${actualQuestion}**\n\n🇦 **A)** ${optA}\n🇧 **B)** ${optB}\n🇨 **C)** ${optC}\n🇩 **D)** ${optD}`; 
    } 

      // 5. Deploy the Challenge & Paint the Reactions 
    const response = await interaction.reply({ 
        content: `🚨 **DISVERZ CHALLENGE INITIATED** 🚨\n\n**Category:** ${question.category.toUpperCase()}\n\n${displayMessage}\n\n*Tap the correct reaction below to secure the bump!*`, 
        withResponse: true 
    }); 

    const message = response.resource?.message;
    if (!message) return;


    try { 
        await message.react('🇦'); 
        await message.react('🇧'); 
        await message.react('🇨'); 
        await message.react('🇩'); 
    } catch (error) { 
        console.error('Failed to deploy reaction buttons:', error); 
    } 

    // 👑 RESTORED: Log the challenge in the database BEFORE we launch the collector
    const challenge = await prisma.challenge.create({
        data: {
            serverId: server.id,
            questionId: question.id,
        }
    });

    // 6. The Reaction Collector 
    const emojiMap: Record<string, string> = { 'A': '🇦', 'B': '🇧', 'C': '🇨', 'D': '🇩' }; 
    const targetEmoji = emojiMap[question.answer.trim().toUpperCase()]; 
    
    const filter = (reaction: MessageReaction, user: User) => { 
        return ['🇦', '🇧', '🇨', '🇩'].includes(reaction.emoji.name as string) && !user.bot; 
    }; 

    const collector = message.createReactionCollector({ filter, time: 2 * 60 * 1000 }); 

    collector.on('collect', async (reaction: MessageReaction, user: User) => { 
        if (reaction.emoji.name !== targetEmoji) return; 

        // --- ANTI-ABUSE SHIELD --- 
        const responseTimeMs = Date.now() - message.createdTimestamp; 
        if (responseTimeMs < 1500) { 
            await channel.send(`⚡ **BEEP BOOP.** <@${user.id}> reacted faster than humanly possible. Script detected. Challenge burned.`); 
            collector.stop('busted'); 
            return; 
        } 

        const accountAgeMs = Date.now() - user.createdTimestamp; 
        if (accountAgeMs < (7 * 24 * 60 * 60 * 1000)) { 
            await channel.send(`🛑 **ACCESS DENIED.** <@${user.id}>, only veteran Discord accounts (7+ days old) can secure the bump.`); 
            return; 
        } 

        // --- VICTORY CONDITION --- 
        collector.stop('answered'); 
        
        await prisma.$transaction([ 
            prisma.challenge.update({ 
                where: { id: challenge.id }, // ⚡ Works perfectly now!
                data: { 
                    answeredByUserId: user.id, 
                    answeredAt: new Date(), 
                    speedMs: responseTimeMs, 
                    isValid: true, 
                } 
            }),
            prisma.server.update({ 
                where: { id: server.id }, 
                data: { 
                    lastChallengeAt: new Date(), 
                    lastHumanMsgAt: new Date(), 
                    isDormant: false, 
                } 
            }) 
        ]); 

        await channel.send( 
            `🔥 **VICTORY!** **${user.username}** identified the correct answer in ${(responseTimeMs / 1000).toFixed(1)}s.\n\nThis server has been bumped to the top of the Active feed on Disverz!` 
        ); 
    }); 

    collector.on('end', async (_, reason) => { 
        if (reason === 'time') { 
            await channel.send('⏰ The challenge has expired. No one secured the bump.'); 
        } 
    }); 
}
