import { prisma } from '../lib/prisma.js';
import dotenv from 'dotenv';
dotenv.config();
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const vanityUrls = [
  // New Gaming
  "fortnite", "apexlegends", "csgo", "rainbow6", "overwatch",
  "leagueoflegends", "rocketleague", "pubg", "terraria", "rust",
  
  // New Tech & AI
  "midjourney", "openai", "stable-diffusion", "nextjs", "typescript",
  "cybersecurity", "webdev", "gamedev", "nodejs", "machinelearning",
  
  // New Entertainment & Pop Culture
  "marvel", "starwars", "movies", "kpop", "bts",
  "horror", "dnd", "tabletop", "sneakers", "streetwear",
  
  // New Lifestyle & Finance
  "stocks", "crypto", "personalfinance", "language", "cars",
  "food", "travel", "sports", "nba", "soccer"
];

const generateTags = (name: string, description: string) => {
  const text = `${name} ${description}`.toLowerCase();
  const tags: string[] = [];
  if (text.includes("game") || text.includes("gaming")) tags.push("gaming");
  if (text.includes("anime") || text.includes("manga")) tags.push("anime");
  if (text.includes("code") || text.includes("dev")) tags.push("coding");
  if (text.includes("chill") || text.includes("chat")) tags.push("social");
  if (text.includes("music") || text.includes("lofi")) tags.push("music");
  if (tags.length === 0) tags.push("community");
  return tags.slice(0, 3);
};

async function seedPublicServers() {
  // Create system user first
  const systemUser = await prisma.user.upsert({
    where: { discordId: 'system' },
    update: {},
    create: {
      discordId: 'system',
      username: 'Disverz System',
      avatar: null,
    }
  });

  console.log(`🚀 Starting ingestion of ${vanityUrls.length} vanity URLs...`);

  for (const vanity of vanityUrls) {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/invites/${vanity}?with_counts=true`,
        {
          headers: {
            'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
          }
        }
      );

      if (!res.ok) {
        console.warn(`⚠️ Skipping ${vanity} - Status: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const guild = data.guild;
      if (!guild) continue;

      const iconUrl = guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
        : null;

      const tags = generateTags(guild.name, guild.description || "");

      await prisma.server.upsert({
        where: { discordId: guild.id },
        update: {
          memberCount: data.approximate_member_count || 0,
          isPublicIndex: true,
          isClaimed: false,
        },
        create: {
          discordId: guild.id,
          name: guild.name,
          description: guild.description || `A public Discord community for ${vanity}.`,
          iconUrl,
          memberCount: data.approximate_member_count || 0,
          inviteLink: `https://discord.gg/${vanity}`,
          category: tags[0] || "general",
          tags,
          ownerId: systemUser.id,
          isPublicIndex: true,
          isClaimed: false,
          isDormant: false,
          welcomeChannelId: null,
          challengeChannelId: null,
        }
      });

      console.log(`✅ ${guild.name} — ${data.approximate_member_count?.toLocaleString()} members`);
      await new Promise(r => setTimeout(r, 1500));

    } catch (error) {
      console.error(`❌ Failed: ${vanity}`, error);
    }
  }

  console.log('✅ Import complete');
}

seedPublicServers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());