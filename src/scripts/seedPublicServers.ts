import { prisma } from '../lib/prisma.js';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ==========================================
// 1. THE GENERATOR: Produce 1,500+ Permutations
// ==========================================
const roots = [
  "chill", "cafe", "lounge", "zone", "hub", "club", "haven", "cove",
  "space", "den", "sanctuary", "hangout", "squad", "clan", "tavern",
  "oasis", "house", "room", "corner", "nook", "realm", "world", "base"
];

const topics = [
  "gaming", "anime", "manga", "dev", "code", "tech", "music", "art",
  "study", "lofi", "pixel", "retro", "rpg", "dnd", "social", "friends",
  "cinema", "chess", "indie", "mod", "crypto", "build", "craft"
];

const modifiers = ["", "the", "official", "community", "hq", "central", "network"];

const candidateVanities: string[] = [];

for (const mod of modifiers) {
  for (const topic of topics) {
    for (const root of roots) {
      if (mod) {
        candidateVanities.push(`${mod}${topic}`);
        candidateVanities.push(`${mod}${root}`);
        candidateVanities.push(`${mod}${topic}${root}`);
      } else {
        candidateVanities.push(`${topic}${root}`);
        candidateVanities.push(`${root}${topic}`);
      }
    }
  }
}

// Remove duplicates to get a clean array of unique vanity slugs
const uniqueVanities = Array.from(new Set(candidateVanities));

// ==========================================
// 2. TAG GENERATOR UTILITY
// ==========================================
const generateTags = (name: string, description: string) => {
  const text = `${name} ${description}`.toLowerCase();
  const tags: string[] = [];
  if (text.includes("game") || text.includes("gaming")) tags.push("gaming");
  if (text.includes("anime") || text.includes("manga")) tags.push("anime");
  if (text.includes("code") || text.includes("dev")) tags.push("coding");
  if (text.includes("chill") || text.includes("chat") || text.includes("cozy")) tags.push("social");
  if (text.includes("music") || text.includes("lofi")) tags.push("music");
  if (tags.length === 0) tags.push("community");
  return tags.slice(0, 3);
};

// ==========================================
// 3. MAIN EXECUTION WITH RATE-LIMIT SAFETY
// ==========================================
async function seedTargetedServers() {
  const systemUser = await prisma.user.upsert({
    where: { discordId: 'system' },
    update: {},
    create: {
      discordId: 'system',
      username: 'Disverz System',
      avatar: null,
    }
  });

  console.log(`🚀 Generated ${uniqueVanities.length} vanity slugs. Booting up the scraper...`);
  let addedCount = 0;

  for (const vanity of uniqueVanities) {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/invites/${vanity}?with_counts=true`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
        }
      );

      // 🛡️ RATE LIMIT PROTECTION
      const remaining = res.headers.get("x-ratelimit-remaining");
      const resetAfter = res.headers.get("x-ratelimit-reset-after");

      if (res.status === 429) {
        const retryAfter = Number(resetAfter || res.headers.get("retry-after") || 5);
        console.warn(`⏳ Rate limit hit on ${vanity}! Sleeping for ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 500));
        continue;
      }

      if (remaining !== null && Number(remaining) <= 2 && resetAfter !== null) {
        const sleepTime = Math.ceil(Number(resetAfter) * 1000) + 200;
        console.log(`🛡️ Throttle protection active: ${remaining} requests left. Waiting ${sleepTime}ms...`);
        await new Promise((r) => setTimeout(r, sleepTime));
      } else {
        // Standard safe cadence: 1 request every 600ms
        await new Promise((r) => setTimeout(r, 600));
      }

      // If the vanity URL doesn't exist, skip silently
      if (!res.ok) continue;

      const data = await res.json();
      const guild = data.guild;
      if (!guild) continue;

      const memberCount = data.approximate_member_count || 0;

      // 👑 TARGET RANGE: 25 to 3,500 members
      if (memberCount < 25 || memberCount > 3500) {
        // Uncomment the next line if you want to see all the ones it skips
        // console.log(`⏩ Skipped ${guild.name} (${memberCount.toLocaleString()} members)`);
        continue;
      }

      const iconUrl = guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
        : null;

      const tags = generateTags(guild.name, guild.description || "");

      // 💾 UPSERT TO DATABASE
      await prisma.server.upsert({
        where: { discordId: guild.id },
        update: {
          memberCount,
          isPublicIndex: true,
        },
        create: {
          discordId: guild.id,
          name: guild.name,
          description: guild.description || `A community for ${guild.name}.`,
          iconUrl,
          memberCount,
          inviteLink: `https://discord.gg/${vanity}`,
          category: tags[0] || "general",
          tags,
          ownerId: systemUser.id,
          isPublicIndex: true,
          isClaimed: false,
          isDormant: false,
          welcomeChannelId: null,
          challengeChannelId: null,
        },
      });

      console.log(`🎯 ADDED: ${guild.name} (${memberCount.toLocaleString()} members) via discord.gg/${vanity}`);
      addedCount++;

    } catch (error) {
      console.error(`❌ Network error on vanity "${vanity}":`, error);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\n🎉 Done! Added ${addedCount} targeted mid-tier servers to Disverz.`);
}

seedTargetedServers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());