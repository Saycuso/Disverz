import { Client, GatewayIntentBits, Events } from "discord.js";
import { registerGuildMemberAdd } from "./listeners/guildMemberAdd.js";
import { startDormancyCheck } from "./dormancyCheck.js";
import { registerMessageCreate } from "./listeners/messageCreate.js";
import * as bumpCommand from "./commands/challenge.js"; // 👑 UPDATED IMPORT ALIAS

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Disverz Bot is online and logged in as ${client.user?.tag}`);
  
  // 1. Deploy the Slash Command to Discord (Registers /bump automatically!)
  try {
    if (client.application) {
      await client.application.commands.set([bumpCommand.data]);
      console.log('✅ /bump Slash command successfully deployed to Discord.');
    }
  } catch (error) {
    console.error('Failed to deploy slash commands:', error);
  }

  // 2. Start the core engines
  registerGuildMemberAdd(client);
  registerMessageCreate(client); // This now only tracks the 5-min heartbeat
  startDormancyCheck(); // The garbage collector that hides dead servers
});

// 3. The Slash Command Listener (The Trigger)
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // 👑 CHECK FOR 'bump' INSTEAD OF 'challenge'
  if (interaction.commandName === 'bump') {
    try {
      await bumpCommand.execute(interaction);
    } catch (error) {
      console.error('Command Execution Error:', error);

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'There was an error executing this command.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
        }
      } catch (discordApiError) {
        console.warn('Could not alert the user about the error because the interaction token expired:', discordApiError);
      }
    }
  }
});

// 4. The Ignition Function
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

export default client;