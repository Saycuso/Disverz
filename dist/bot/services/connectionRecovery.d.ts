import { type Client } from "discord.js";
type ServerConnection = {
    id: string;
    discordId: string;
    inviteLink: string;
    welcomeChannelId: string | null;
    challengeChannelId: string | null;
    bumpReminders: boolean;
    isClaimed: boolean;
    isPublicIndex: boolean;
};
export interface ConnectionStore {
    findUnique(args: {
        where: {
            id: string;
        };
    }): Promise<ServerConnection | null>;
    updateMany(args: {
        where: ServerConnection;
        data: {
            inviteLink: string;
            welcomeChannelId: string | null;
            challengeChannelId: string | null;
        };
    }): Promise<{
        count: number;
    }>;
}
export type InviteInspection = {
    state: "valid";
    channelId: string | null;
} | {
    state: "invalid" | "retry";
};
export type ConnectionResult = {
    state: "ready" | "partial" | "blocked" | "retry";
    inviteLink: string | null;
    reminderChannelId: string | null;
};
export declare function discordErrorCode(error: unknown): number | undefined;
export declare function inviteCodeFromLink(link: string): string | null;
export declare function inspectDiscordInvite(link: string, guildId: string): Promise<InviteInspection>;
export declare function createConnectionRecovery(client: Client, dependencies?: {
    store?: ConnectionStore;
    inspectInvite?: typeof inspectDiscordInvite;
    now?: () => number;
    log?: (message: string) => void;
}): {
    ensure: (serverId: string) => Promise<ConnectionResult>;
    invalidate: (serverId: string) => void;
};
export type ConnectionRecovery = ReturnType<typeof createConnectionRecovery>;
export {};
//# sourceMappingURL=connectionRecovery.d.ts.map