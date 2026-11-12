import "dotenv/config";
type Guild = {
    id: string;
    name: string;
    description: string;
    icon: string | null;
    count: number;
    locale: string;
    restricted: boolean;
};
type Options = {
    write: boolean;
    recheck: boolean;
    limit: number;
    maxRequests: number;
    min: number;
    max: number;
    gap: number;
    depth: number;
    port: number;
    wordsFile?: string;
    invitesFile?: string;
};
export declare function parseInvite(input: string): string;
export declare function normalize(value: string): string;
export declare function generateCandidates(words: string[], depth: number, invites?: string[]): Generator<string, void, unknown>;
export declare function classify(name: string, description: string): {
    category: string;
    tags: string[];
};
export declare function decodeGuild(value: unknown): Guild | null;
export declare function retryDelay(headers: Headers, body: unknown, now?: number): number;
export declare function options(args: string[]): Options;
export declare function run(config: Options): Promise<{
    added: number;
    eligible: number;
    existing: number;
    missing: number;
    filtered: number;
    duplicates: number;
    skipped: number;
    cached: number;
    requests: number;
    rateLimits: number;
}>;
export {};
//# sourceMappingURL=seedPublicServers.d.ts.map