import { Client } from "discord.js";
declare const client: Client<boolean>;
export declare const connectionRecovery: {
    ensure: (serverId: string) => Promise<import("./services/connectionRecovery.js").ConnectionResult>;
    invalidate: (serverId: string) => void;
};
export declare const startBot: () => Promise<void>;
export default client;
//# sourceMappingURL=bot.d.ts.map