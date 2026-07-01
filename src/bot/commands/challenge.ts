import { 
  SlashCommandBuilder, 
  CommandInteraction,
  Message,
  TextChannel
} from 'discord.js';
import { prisma } from '../../lib/prisma.js';

export const data = new SlashCommandBuilder()
  .setName('challenge')
  .setDescription('Trigger a Disverz trivia challenge to bump your server.');

export async function execute(interaction: CommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command only works inside a server.', ephemeral: true });
    return;
  }

  // 1. Target Acquisition
  const server = await prisma.server.findUnique({
    where: { discordId: guildId }
  });

  if (!server) {
    await interaction.reply({ 
      content: '❌ This server is not registered. The owner must list it on disverz.com first.', 
      ephemeral: true 
    });
    return;
  }

  // 2. Cooldown Strategy (Prevents spamming the command)
  const COOLDOWN_HOURS = 2; // Fixed at 2 hours for V1
  if (server.lastChallengeAt) {
    const hoursSinceLast = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < COOLDOWN_HOURS) {
      const minutesLeft = Math.ceil((COOLDOWN_HOURS - hoursSinceLast) * 60);
      await interaction.reply({ 
        content: `⏳ The blade is resting. Next challenge available in **${minutesLeft} minutes**.`, 
        ephemeral: true 
      });
      return;
    }
  }

  // 3. Draw the Weapon (Fetch Question)
  const questions = await prisma.$queryRaw<Array<{
    id: string; category: string; text: string; answer: string;
  }>>`
    SELECT * FROM "Question"
    WHERE category = ${server.category}
    ORDER BY RANDOM()
    LIMIT 1
  `;

  const question = questions[0];
  if (!question) {
    await interaction.reply({ content: '❌ No questions found for this category.', ephemeral: true });
    return;
  }

  // 4. Fire the Challenge
  await interaction.reply(
    `🚨 **DISVERZ CHALLENGE INITIATED** 🚨\n\n**Category:** ${question.category.toUpperCase()}\n\n❓ **${question.text}**\n\n*The first human to answer correctly secures the bump on disverz.com.*`
  );

  const challenge = await prisma.challenge.create({
    data: {
      serverId: server.id,
      questionId: question.id,
    }
  });

  // 5. The Collector (Listens strictly in this channel for 15 minutes)
  const channel = interaction.channel as TextChannel;
  const filter = (msg: Message) => !msg.author.bot;
  const collector = channel.createMessageCollector({ 
    filter, 
    time: 2 * 60 * 1000 
  });

  collector.on('collect', async (msg: Message) => {
    const userAnswer = msg.content.trim().toLowerCase();
    const correctAnswer = question.answer.trim().toLowerCase();
    
    // We only react if the answer is completely correct
    if (userAnswer !== correctAnswer) return;

    // --- ANTI-ABUSE SHIELD ---
    const responseTimeMs = msg.createdTimestamp - interaction.createdTimestamp;
    
    // Speed Check: Under 2.5s is mathematically impossible for humans
    if (responseTimeMs < 2500) {
      await msg.reply('⚡ **BEEP BOOP.** You answered faster than humanly possible. Script detected. Challenge burned.');
      collector.stop('busted');
      return;
    }

    // Veteran Check: Account must be 7 days old
    const accountAgeMs = Date.now() - msg.author.createdTimestamp;
    if (accountAgeMs < (7 * 24 * 60 * 60 * 1000)) {
      await msg.reply('🛑 **ACCESS DENIED.** Only veteran Discord accounts (7+ days old) can secure the bump.');
      return;
    }

    // --- VICTORY CONDITION (V1 Math-Free Bump) ---
    collector.stop('answered');

    await prisma.$transaction([
      prisma.challenge.update({
        where: { id: challenge.id },
        data: {
          answeredByUserId: msg.author.id,
          answeredAt: new Date(),
          speedMs: responseTimeMs,
          isValid: true,
        }
      }),
      prisma.server.update({
        where: { id: server.id },
        data: {
          lastChallengeAt: new Date(), // This is the ONLY thing that matters for the V1 Active tab
          lastHumanMsgAt: new Date(),
          isDormant: false,
        }
      })
    ]);

    await channel.send(
      `🔥 **VICTORY!** **${msg.author.username}** answered correctly in ${(responseTimeMs / 1000).toFixed(1)}s.\n\nThis server has been bumped to the top of the Active feed on Disverz!`
    );
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      await channel.send('⏰ The challenge has expired. No one secured the bump.');
    }
  });
}