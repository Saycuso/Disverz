import { type Client } from "discord.js";
import { type ConnectionRecovery } from "../services/connectionRecovery.js";
export declare function createReminderRunner(client: Client, recovery: ConnectionRecovery, database?: import("@prisma/client").PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/client").DefaultArgs>): () => Promise<void>;
export declare function startReminderEngine(client: Client, recovery: ConnectionRecovery): void;
//# sourceMappingURL=reminderEngine.d.ts.map