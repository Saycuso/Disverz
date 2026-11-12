import "dotenv/config";
import { prisma } from "../lib/prisma.js";
import { readFile, mkdir, open, rename, truncate, } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
// Vocabulary, NOT a fixed list of invite codes.
// Phrases become combinations.
const TOPICS = [
    "gaming,minecraft,valorant,roblox,fortnite,terraria,warframe,overwatch,apex legends,rocket league,destiny,stardew valley,genshin impact,honkai,final fantasy,path of exile,elden ring,dark souls,factorio,satisfactory,runescape,world of warcraft,league of legends,dota,csgo,counter strike,osu,pokemon,zelda,nintendo,playstation,xbox,steam,indie games,retro games,speedrun,esports,sim racing",
    "anime,manga,manhwa,webtoon,one piece,naruto,bleach,dragon ball,jujutsu kaisen,demon slayer,attack on titan,chainsaw man,berserk,jojo,evangelion,studio ghibli,cosplay,vtuber,hololive,vocaloid,fanart",
    "coding,programming,web development,javascript,typescript,python,java,golang,rust,cpp,csharp,nodejs,react,reactiflux,nextjs,vue,svelte,angular,deno,bun,php,laravel,django,flask,fastapi,postgres,mongodb,sql,opensource,algorithms,leetcode,competitive programming,cybersecurity,linux,ubuntu,archlinux,devops,docker,kubernetes",
    "art,drawing,painting,digital art,pixel art,animation,blender,3d modeling,3d printing,krita,procreate,photoshop,illustration,graphic design,ui design,ux design,figma,photography,filmmaking,video editing,after effects,davinci resolve,gamedev,godot,unity,unreal engine,game design",
    "music,music production,fl studio,ableton,reaper,logic pro,cubase,pro tools,bandlab,guitar,piano,drums,violin,bass,singing,songwriting,sound design,synthesizer,lofi,jazz,hip hop,rap,metal,rock,pop,kpop,classical,edm,dubstep,techno,house music,dnb,monstercat",
    "study,students,university,college,homework,mathematics,physics,chemistry,biology,astronomy,science,engineering,electronics,robotics,arduino,raspberry pi,history,geography,philosophy,psychology,economics,medicine,law,architecture,statistics,data science,machine learning,ai,research,productivity,pomodoro",
    "language learning,english,german,deutsch,french,francais,spanish,espanol,italian,portuguese,brazilian,japanese,korean,chinese,mandarin,hindi,arabic,turkish,russian,ukrainian,polish,dutch,swedish,norwegian,finnish,danish,greek,romanian,vietnamese,thai,indonesian,tagalog,polyglot,linguistics",
    "community,social,friends,friendship,chill,cozy,cafe,lounge,hangout,chat,international,penpals,introverts,night owls,morning,wholesome,memes,funny,comedy,discussion,debate,creators,streamers,twitch,youtube,podcasts",
    "books,reading,writing,writers,literature,poetry,worldbuilding,fantasy,science fiction,scifi,horror,mystery,romance,comics,movies,cinema,television,star wars,star trek,marvel,dc comics,doctor who,lord of the rings,harry potter,dune",
    "dnd,dungeons and dragons,tabletop,board games,chess,checkers,poker,magic the gathering,yugioh,warhammer,miniatures,lego,puzzles,sudoku,geoguessr,roleplay,lfg,ttrpg,dungeon masters",
    "cooking,baking,food,coffee,tea,gardening,plants,houseplants,crochet,knitting,sewing,woodworking,crafts,origami,calligraphy,collecting,vinyl,watches,fashion,streetwear,sneakers,perfume,skincare,pets,cats,dogs,aquariums,birding",
    "fitness,gym,bodybuilding,calisthenics,running,cycling,hiking,climbing,camping,backpacking,travel,yoga,meditation,football,soccer,basketball,tennis,badminton,volleyball,cricket,baseball,hockey,swimming,skating,skiing,snowboarding,surfing,f1,motorsport,cars,motorcycles,aviation",
    "technology,hardware,pc building,mechanical keyboards,keyboards,homelab,self hosted,networking,servers,privacy,digital privacy,android,ios,apple,mac,windows,vr,ar,virtual reality,augmented reality,3d scanning,drone,drones,fpv,ham radio,astronomy gear",
    "germany,berlin,munich,hamburg,chemnitz,leipzig,dresden,france,paris,spain,italy,netherlands,uk,london,ireland,canada,usa,australia,new zealand,india,mumbai,pune,delhi,brazil,mexico,japan,korea,philippines,indonesia,malaysia,singapore,south africa,europe,asia,africa,latin america",
    "business,startups,entrepreneurs,freelance,freelancers,remote work,careers,jobs,internships,werkstudent,portfolios,resumes,interviews,marketing,seo,ecommerce,finance,personal finance,investing,budgeting,accounting,designers,developers,makers,builders,founders",
].map((group) => group.split(","));
const ROOTS = "hub,community,club,lounge,cafe,zone,world,realm,space,place,house,corner,den,cove,network,central,hangout,friends,collective,society,guild,academy,lab,studio".split(",");
const PREFIXES = "the,its,our,all,just,only,team,project,global,international".split(",");
const SEPARATORS = ["", "-", "_"];
const VALID_CODE = /^[A-Za-z0-9_-]{2,100}$/;
class BudgetReached extends Error {
}
export function parseInvite(input) {
    const text = input.trim();
    // Keep case: random invite codes are case-sensitive.
    if (VALID_CODE.test(text))
        return text;
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["discord.gg", "discord.com", "discordapp.com"].includes(host) ||
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port) {
        throw new Error(`Invalid invite: ${text}`);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const code = host === "discord.gg" && parts.length === 1
        ? parts[0]
        : parts.length === 2 && parts[0] === "invite"
            ? parts[1]
            : undefined;
    if (!code || !VALID_CODE.test(code)) {
        throw new Error(`Invalid invite: ${text}`);
    }
    return code;
}
export function normalize(value) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
export function* generateCandidates(words, depth, invites = []) {
    const seen = new Set();
    function* emit(code) {
        if (VALID_CODE.test(code) && !seen.has(code)) {
            seen.add(code);
            yield code;
        }
    }
    for (const invite of invites) {
        yield* emit(parseInvite(invite));
    }
    // Words can grow when successful lookups teach us community names.
    for (const separator of SEPARATORS) {
        for (let i = 0; i < words.length; i++) {
            yield* emit(words[i].replace(/ /g, separator));
        }
    }
    if (depth >= 2) {
        for (const root of ROOTS) {
            for (const separator of SEPARATORS) {
                for (let i = 0; i < words.length; i++) {
                    const word = words[i].replace(/ /g, separator);
                    yield* emit(`${word}${separator}${root}`);
                    yield* emit(`${root}${separator}${word}`);
                }
            }
        }
    }
    if (depth >= 3) {
        for (const prefix of PREFIXES) {
            for (const separator of SEPARATORS) {
                for (let i = 0; i < words.length; i++) {
                    const word = words[i].replace(/ /g, separator);
                    yield* emit(`${prefix}${separator}${word}`);
                    for (const root of ROOTS) {
                        yield* emit(`${prefix}${separator}${word}${separator}${root}`);
                    }
                }
            }
        }
    }
}
// Categories are guesses from returned metadata,
// not from the guessed invite code.
const RULES = [
    [
        "gaming",
        /\b(gaming|gamers|minecraft|valorant|roblox|fortnite|terraria|warframe|overwatch|genshin|honkai|esports|video games?|rocket league|final fantasy|path of exile|elden ring|dota|runescape|warcraft|dungeons|tabletop)\b/i,
    ],
    [
        "coding",
        /\b(coding|programming|javascript|typescript|python|react|nodejs|web dev\w*|software|golang|rust|gamedev|godot|unity|unreal)\b/i,
    ],
    [
        "anime",
        /\b(anime|manga|manhwa|webtoon|naruto|one piece|cosplay|vtuber|hololive)\b/i,
    ],
    [
        "music",
        /\b(music|musicians|fl studio|ableton|reaper|guitar|piano|singing|songwriting|lofi|jazz|hip hop|edm|kpop)\b/i,
    ],
    [
        "art",
        /\b(art|artists|drawing|painting|animation|blender|photography|design|3d printing|crochet|knitting|crafts)\b/i,
    ],
    [
        "books",
        /\b(books|reading|writers|writing|literature|poetry|worldbuilding)\b/i,
    ],
    [
        "education",
        /\b(study|studying|students|university|learning|language|mathematics|physics|chemistry|biology|science|engineering|research)\b/i,
    ],
    [
        "technology",
        /\b(technology|linux|ubuntu|homelab|hardware|keyboards|arduino|robotics|electronics|networking|self hosted|privacy|pc building)\b/i,
    ],
    [
        "sports",
        /\b(sports|football|soccer|basketball|cricket|fitness|gym|running|cycling|hiking|climbing|motorsport|formula 1)\b/i,
    ],
    [
        "movies",
        /\b(movies|cinema|television|star wars|star trek|doctor who)\b/i,
    ],
    [
        "finance",
        /\b(finance|investing|accounting|budgeting|business|startups|entrepreneurs)\b/i,
    ],
    ["meme", /\b(memes|comedy|funny)\b/i],
    ["chill", /\b(chill|cozy|lofi|cafe|lounge)\b/i],
    [
        "social",
        /\b(social|friends|friendship|hangout|chat|community)\b/i,
    ],
];
export function classify(name, description) {
    const tags = RULES.filter(([, pattern]) => pattern.test(`${name} ${description}`)).map(([category]) => category);
    return {
        category: tags[0] ?? "general",
        tags: tags.length ? tags.slice(0, 5) : ["community"],
    };
}
export function decodeGuild(value) {
    if (!value || typeof value !== "object")
        return null;
    const data = value;
    const guild = data.guild;
    if (!guild ||
        !/^\d{17,20}$/.test(String(guild.id)) ||
        typeof guild.id !== "string" ||
        typeof guild.name !== "string" ||
        !guild.name.trim()) {
        return null;
    }
    if (!Number.isSafeInteger(data.approximate_member_count) ||
        data.approximate_member_count < 0 ||
        data.approximate_member_count > 2147483647) {
        return null;
    }
    return {
        id: guild.id,
        name: guild.name.slice(0, 100),
        description: typeof guild.description === "string"
            ? guild.description.slice(0, 2000)
            : "",
        icon: typeof guild.icon === "string" &&
            /^[A-Za-z0-9_]+$/.test(guild.icon)
            ? guild.icon
            : null,
        count: data.approximate_member_count,
        locale: typeof guild.preferred_locale === "string"
            ? guild.preferred_locale
            : "",
        restricted: guild.nsfw_level === 1 || guild.nsfw_level === 3,
    };
}
export function retryDelay(headers, body, now = Date.now()) {
    const delays = [];
    const addSeconds = (value) => {
        if (value === null ||
            value === undefined ||
            value === "") {
            return;
        }
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) {
            delays.push(seconds * 1000);
        }
    };
    const retry = headers.get("retry-after");
    if (retry !== null) {
        if (Number.isFinite(Number(retry))) {
            addSeconds(retry);
        }
        else {
            const date = Date.parse(retry);
            if (Number.isFinite(date)) {
                delays.push(Math.max(0, date - now));
            }
        }
    }
    if (body &&
        typeof body === "object" &&
        "retry_after" in body) {
        addSeconds(body.retry_after);
    }
    addSeconds(headers.get("x-ratelimit-reset-after"));
    const absolute = headers.get("x-ratelimit-reset");
    if (absolute !== null &&
        Number.isFinite(Number(absolute))) {
        const serverNow = Date.parse(headers.get("date") ?? "");
        delays.push(Math.max(0, Number(absolute) * 1000 -
            (Number.isFinite(serverNow) ? serverNow : now)));
    }
    return Math.ceil((delays.length ? Math.max(...delays) : 60000) + 1000);
}
export function options(args) {
    const values = new Map();
    for (const argument of args) {
        const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argument);
        if (!match) {
            throw new Error(`Use --option=value, not: ${argument}`);
        }
        values.set(match[1], match[2] ?? "true");
    }
    const allowed = new Set([
        "write",
        "fresh",
        "recheck",
        "limit",
        "max-requests",
        "min-members",
        "max-members",
        "gap-ms",
        "depth",
        "lock-port",
        "words",
        "invites",
    ]);
    for (const name of values.keys()) {
        if (!allowed.has(name)) {
            throw new Error(`Unknown option --${name}`);
        }
    }
    const number = (name, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => {
        const value = values.has(name)
            ? Number(values.get(name))
            : fallback;
        if (!Number.isSafeInteger(value) ||
            value < minimum ||
            value > maximum) {
            throw new Error(`--${name}: expected integer ${minimum}–${maximum}`);
        }
        return value;
    };
    const min = number("min-members", 25, 0);
    const max = number("max-members", 10000000, 0, 2147483647);
    if (min > max) {
        throw new Error("min-members must be <= max-members");
    }
    const hash = createHash("sha256")
        .update(resolve("."))
        .digest()
        .readUInt16BE(0);
    return {
        write: values.get("write") === "true",
        recheck: values.has("fresh") || values.has("recheck"),
        limit: number("limit", 200),
        maxRequests: number("max-requests", 2000),
        min,
        max,
        gap: number("gap-ms", 2500, 1500, 60000),
        depth: number("depth", 3, 1, 3),
        port: number("lock-port", 41000 + (hash % 16000), 1024, 65535),
        ...(values.has("words")
            ? { wordsFile: values.get("words") }
            : {}),
        ...(values.has("invites")
            ? { invitesFile: values.get("invites") }
            : {}),
    };
}
async function lines(file) {
    return file
        ? (await readFile(resolve(file), "utf8"))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"))
        : [];
}
// The OS releases this local TCP lock after a crash.
// No stale lock files.
async function acquireLock(port) {
    const server = createServer((socket) => socket.destroy());
    await new Promise((accept, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            server.removeListener("error", reject);
            accept();
        });
    }).catch((error) => {
        throw new Error(`Importer lock unavailable on port ${port}. Another run may be active. ${String(error)}`);
    });
    return () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
}
async function readJournal(file) {
    let raw = "";
    try {
        raw = await readFile(file, "utf8");
    }
    catch (error) {
        if (error.code !==
            "ENOENT") {
            throw error;
        }
    }
    const end = raw.lastIndexOf("\n") + 1;
    if (end < raw.length) {
        await truncate(file, Buffer.byteLength(raw.slice(0, end)));
        console.warn("Recovered an interrupted final progress record.");
    }
    const cache = new Map();
    for (const line of raw
        .slice(0, end)
        .split("\n")) {
        if (!line.trim())
            continue;
        const entry = JSON.parse(line);
        if (!VALID_CODE.test(entry.code) ||
            ![
                "missing",
                "found",
                "filtered",
                "existing",
                "added",
                "duplicate",
            ].includes(entry.status) ||
            !Number.isFinite(entry.at)) {
            throw new Error("Progress journal is damaged; keep a backup before repairing it.");
        }
        cache.set(entry.code, entry);
    }
    return cache;
}
export async function run(config) {
    const releaseLock = await acquireLock(config.port);
    const shutdown = new AbortController();
    const stop = () => {
        console.log("\nStopping; saving completed work...");
        shutdown.abort();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const stats = {
        added: 0,
        eligible: 0,
        existing: 0,
        missing: 0,
        filtered: 0,
        duplicates: 0,
        skipped: 0,
        cached: 0,
        requests: 0,
        rateLimits: 0,
    };
    let journal;
    let reason = "Candidate combinations exhausted";
    try {
        const directory = resolve(".cache/disverz-discovery-v3");
        await mkdir(directory, { recursive: true });
        const journalFile = resolve(directory, "progress.jsonl");
        const cooldownFile = resolve(directory, "cooldown.json");
        const cache = await readJournal(journalFile);
        journal = await open(journalFile, "a");
        let nextAt = 0;
        try {
            const saved = JSON.parse(await readFile(cooldownFile, "utf8"));
            if (!Number.isFinite(saved.until) ||
                saved.until < 0) {
                throw new Error("Invalid saved cooldown");
            }
            nextAt = saved.until;
        }
        catch (error) {
            if (error.code !==
                "ENOENT") {
                throw error;
            }
        }
        const holdUntil = async (until) => {
            nextAt = Math.max(nextAt, until);
            const temporary = `${cooldownFile}.${randomUUID()}.tmp`;
            const handle = await open(temporary, "w");
            try {
                await handle.writeFile(JSON.stringify({ until: nextAt }));
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await rename(temporary, cooldownFile);
        };
        const wait = async () => {
            while (nextAt > Date.now()) {
                const remaining = nextAt - Date.now();
                if (remaining > 5000) {
                    console.log(`WAIT ${Math.ceil(remaining / 1000)}s — honoring saved pacing / Discord cooldown`);
                }
                await sleep(Math.min(remaining, 30000), undefined, { signal: shutdown.signal });
            }
        };
        const record = async (entry) => {
            await journal.appendFile(`${JSON.stringify(entry)}\n`);
            cache.set(entry.code, entry);
        };
        const words = [];
        const wordSet = new Set();
        const addWord = (raw) => {
            const word = normalize(raw);
            if (word.length >= 3 &&
                word.length <= 40 &&
                !wordSet.has(word) &&
                words.length < 3000) {
                words.push(word);
                wordSet.add(word);
            }
        };
        // User vocabulary first; then mix categories.
        for (const word of await lines(config.wordsFile)) {
            addWord(word);
        }
        for (let i = 0; i <
            Math.max(...TOPICS.map((group) => group.length)); i++) {
            for (const group of TOPICS) {
                if (group[i])
                    addWord(group[i]);
            }
        }
        const learn = (guild) => {
            const name = normalize(guild.name);
            addWord(name);
            for (const word of name.split(" ")) {
                if (!/^(the|and|for|with|join|discord|server|official|welcome)$/.test(word)) {
                    addWord(word);
                }
            }
        };
        for (const entry of cache.values()) {
            if (entry.guild)
                learn(entry.guild);
        }
        const invites = (await lines(config.invitesFile)).map(parseInvite);
        const seenGuilds = new Set();
        let systemId;
        let networkFailures = 0;
        const lookup = async (code) => {
            for (let attempt = 0; attempt < 5; attempt++) {
                shutdown.signal.throwIfAborted();
                if (stats.requests >= config.maxRequests) {
                    throw new BudgetReached();
                }
                await wait();
                shutdown.signal.throwIfAborted();
                stats.requests++;
                console.log(`[${stats.requests}/${config.maxRequests}] CHECK ${code}`);
                let response;
                try {
                    response = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`, {
                        redirect: "error",
                        signal: AbortSignal.any([
                            shutdown.signal,
                            AbortSignal.timeout(15000),
                        ]),
                        headers: {
                            "User-Agent": "DisverzDirectoryImporter/3.0 (+https://disverz.com)",
                        },
                    });
                }
                catch (error) {
                    if (shutdown.signal.aborted) {
                        throw error;
                    }
                    if (++networkFailures >= 8) {
                        throw new Error("Repeated network failures. Progress saved; retry later.");
                    }
                    await holdUntil(Date.now() +
                        Math.max(config.gap, 2000 * 2 ** attempt));
                    console.warn(`Network/timeout failure; retry ${attempt + 1}/5 for ${code}`);
                    continue;
                }
                // Save pacing before reading the body.
                let delay = config.gap +
                    Math.floor(Math.random() * 500);
                const remaining = response.headers.get("x-ratelimit-remaining");
                if (remaining !== null &&
                    Number(remaining) <= 1) {
                    delay = Math.max(delay, retryDelay(response.headers, null));
                }
                await holdUntil(Date.now() + delay);
                let body = null;
                try {
                    body = JSON.parse(await response.text());
                }
                catch (error) {
                    if (shutdown.signal.aborted) {
                        throw error;
                    }
                }
                if (response.status === 429) {
                    stats.rateLimits++;
                    const retry = retryDelay(response.headers, body);
                    await holdUntil(Date.now() + retry);
                    console.warn(`429: wait at least ${Math.ceil(retry / 1000)}s, then retry SAME code ${code}`);
                    if (stats.rateLimits >= 10) {
                        throw new Error("Repeated rate limits. Cooldown saved; stopping this run.");
                    }
                    continue;
                }
                if (response.status === 401 ||
                    response.status === 403) {
                    throw new Error(`Discord HTTP ${response.status}: stopped; no access-control retries.`);
                }
                if (response.status === 404) {
                    networkFailures = 0;
                    return null;
                }
                if (response.status >= 500 ||
                    (response.ok && body === null)) {
                    if (++networkFailures >= 8) {
                        throw new Error("Discord/network is repeatedly failing. Retry later.");
                    }
                    await holdUntil(Date.now() +
                        Math.max(config.gap, 2000 * 2 ** attempt));
                    console.warn(`Temporary failure; retry ${attempt + 1}/5 for ${code}`);
                    continue;
                }
                if (!response.ok) {
                    throw new Error(`Discord HTTP ${response.status}: stopped; progress saved.`);
                }
                networkFailures = 0;
                // Skip group-DM/friend invites.
                if (body &&
                    typeof body === "object" &&
                    "type" in body &&
                    (body.type === 1 ||
                        body.type === 2)) {
                    return null;
                }
                const guild = decodeGuild(body);
                if (!guild) {
                    throw new Error(`Unexpected/missing guild metadata for ${code}; stopped without caching it as invalid.`);
                }
                return guild;
            }
            throw new Error(`Retry attempts exhausted for ${code}; it remains unchecked for the next run.`);
        };
        console.log(`\n${config.write ? "IMPORT" : "PREVIEW"} | ${words.length} starting words | depth ${config.depth}`);
        console.log(`Target: ${config.limit} new listings | members ${config.min}–${config.max} | request budget ${config.maxRequests}`);
        console.log("Checked codes are skipped on later runs; the generator continues to new combinations.\n");
        for (const code of generateCandidates(words, config.depth, invites)) {
            shutdown.signal.throwIfAborted();
            if ((config.write
                ? stats.added
                : stats.eligible) >= config.limit) {
                reason =
                    "New-listing target reached";
                break;
            }
            const previous = cache.get(code);
            let guild;
            let checkedAt = Date.now();
            if (previous &&
                !config.recheck) {
                if (!previous.guild ||
                    [
                        "added",
                        "existing",
                        "duplicate",
                    ].includes(previous.status)) {
                    stats.skipped++;
                    continue;
                }
                if (Date.now() - previous.at <
                    3 * 86400000) {
                    guild = previous.guild;
                    checkedAt = previous.at;
                    stats.cached++;
                }
                else {
                    guild = await lookup(code);
                    checkedAt = Date.now();
                }
            }
            else {
                guild = await lookup(code);
                checkedAt = Date.now();
            }
            let status;
            if (!guild) {
                stats.missing++;
                status = "missing";
                console.log(`MISS ${code}`);
            }
            else if (seenGuilds.has(guild.id)) {
                stats.duplicates++;
                status = "duplicate";
                console.log(`DUPLICATE ${guild.name}`);
            }
            else {
                seenGuilds.add(guild.id);
                if (!guild.restricted) {
                    learn(guild);
                }
                const existing = await prisma.server.findUnique({
                    where: {
                        discordId: guild.id,
                    },
                    select: {
                        id: true,
                    },
                });
                if (existing) {
                    stats.existing++;
                    status = "existing";
                    console.log(`EXISTS ${guild.name}`);
                }
                else if (guild.restricted ||
                    guild.count < config.min ||
                    guild.count > config.max) {
                    stats.filtered++;
                    status = "filtered";
                    console.log(`FILTER ${guild.name} | ${guild.count} members`);
                }
                else {
                    stats.eligible++;
                    status = "found";
                    if (config.write) {
                        if (!systemId) {
                            systemId = (await prisma.user.upsert({
                                where: {
                                    discordId: "system",
                                },
                                update: {},
                                create: {
                                    discordId: "system",
                                    username: "Disverz System",
                                    avatar: null,
                                },
                            })).id;
                        }
                        const result = await prisma.server.createMany({
                            skipDuplicates: true,
                            data: [
                                {
                                    discordId: guild.id,
                                    name: guild.name,
                                    description: guild.description ||
                                        `A Discord community for ${guild.name}.`,
                                    inviteLink: `https://discord.gg/${code}`,
                                    iconUrl: guild.icon
                                        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
                                        : null,
                                    memberCount: guild.count,
                                    ...classify(guild.name, guild.description),
                                    language: {
                                        en: "English",
                                        de: "German",
                                        fr: "French",
                                        es: "Spanish",
                                        pt: "Portuguese",
                                        ru: "Russian",
                                        tr: "Turkish",
                                        ja: "Japanese",
                                        ko: "Korean",
                                        zh: "Chinese",
                                        hi: "Hindi",
                                        ar: "Arabic",
                                    }[guild.locale.split("-")[0]] ?? "Unknown",
                                    ownerId: systemId,
                                    isPublicIndex: true,
                                    isClaimed: false,
                                    isDormant: false,
                                    bumpReminders: false,
                                    welcomeChannelId: null,
                                    challengeChannelId: null,
                                    lastHumanMsgAt: null,
                                    lastChallengeAt: null,
                                },
                            ],
                        });
                        status = result.count
                            ? "added"
                            : "existing";
                        if (result.count) {
                            stats.added++;
                        }
                        else {
                            stats.existing++;
                        }
                    }
                    console.log(`${status.toUpperCase()} ${guild.name} | ${guild.count.toLocaleString()} members | discord.gg/${code}`);
                }
            }
            await record({
                code,
                status,
                at: checkedAt,
                ...(guild ? { guild } : {}),
            });
        }
        return stats;
    }
    catch (error) {
        if (error instanceof BudgetReached) {
            reason =
                "Request budget reached; rerun the same command to continue";
            return stats;
        }
        if (shutdown.signal.aborted) {
            reason =
                "Stopped by you; completed work saved";
            return stats;
        }
        reason = `Stopped: ${error instanceof Error
            ? error.message
            : String(error)}`;
        throw error;
    }
    finally {
        try {
            if (journal) {
                await journal.sync();
                await journal.close();
            }
        }
        finally {
            process.removeListener("SIGINT", stop);
            process.removeListener("SIGTERM", stop);
            await releaseLock();
            console.log(`\n${reason}\nRun summary:\n${JSON.stringify(stats, null, 2)}`);
        }
    }
}
if (process.argv[1] &&
    import.meta.url ===
        pathToFileURL(resolve(process.argv[1])).href) {
    run(options(process.argv.slice(2)))
        .catch((error) => {
        console.error(error instanceof Error
            ? error.message
            : error);
        process.exitCode = 1;
    })
        .finally(() => prisma.$disconnect());
}
//# sourceMappingURL=seedPublicServers.js.map