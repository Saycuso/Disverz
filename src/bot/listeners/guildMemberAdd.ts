// src/bot/listeners/guildMemberAdd.ts
import { Client } from 'discord.js';

export function registerGuildMemberAdd(client: Client) {
  client.on('guildMemberAdd', async (member) => {
    console.log(`[JOIN] ${member.user.tag} joined ${member.guild.name}`);
    // TODO: cross-reference with JoinClick table once frontend tracking exists
  });
}