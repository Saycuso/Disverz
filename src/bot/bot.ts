import { Client, GatewayIntentBits } from "discord.js";
import { registerGuildMemberAdd } from "./listeners/guildMemberAdd.js";
import { startDormancyCheck } from "./dormancyCheck.js";
import { registerMessageCreate } from "./listeners/messageCreate.js";
import { startChallengeScheduler } from "./challengeScheduler.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("clientReady", () => {
  console.log(`🤖 Disverz Bot is online and logged in as ${client.user?.tag}`);
  registerGuildMemberAdd(client);
  registerMessageCreate(client);
  startDormancyCheck(); // ← add this
  startChallengeScheduler(client); // ← this line must exist
});

// 3. The Ignition Function
export const startBot = async () => {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("CRITICAL: DISCORD_BOT_TOKEN is missing in .env");
    return;
  }

  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error("Bot Login Error:", error);
  }
};
