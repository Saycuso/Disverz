import {
  ChannelType,
  GuildFeature,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type NewsChannel,
  type TextChannel,
} from "discord.js";
import {prisma} from "../../lib/prisma.js";

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
    where: { id: string };
  }): Promise<ServerConnection | null>;

  updateMany(args: {
    where: ServerConnection;
    data: {
      inviteLink: string;
      welcomeChannelId: string | null;
      challengeChannelId: string | null;
    };
  }): Promise<{ count: number }>;
}

export type InviteInspection =
  | { state: "valid"; channelId: string | null }
  | { state: "invalid" | "retry" };

export type ConnectionResult = {
  state: "ready" | "partial" | "blocked" | "retry";
  inviteLink: string | null;
  reminderChannelId: string | null;
};

type PostingChannel = TextChannel | NewsChannel;

const MINUTE = 60_000;

const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.CreateInstantInvite,
];

const REMINDER_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

let inviteCooldownUntil = 0;

export function discordErrorCode(
  error: unknown,
): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return;
  }

  const code = Number(error.code);
  return Number.isFinite(code) ? code : undefined;
}

export function inviteCodeFromLink(link: string): string | null {
  try {
    const url = new URL(link);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);

    const code =
      url.hostname === "discord.gg" && parts.length === 1
        ? parts[0]
        : ["discord.com", "www.discord.com"].includes(
              url.hostname,
            ) &&
            parts.length === 2 &&
            parts[0] === "invite"
          ? parts[1]
          : undefined;

    return code &&
      code !== "pending" &&
      /^[A-Za-z0-9-]+$/.test(code)
      ? code
      : null;
  } catch {
    return null;
  }
}

export async function inspectDiscordInvite(
  link: string,
  guildId: string,
): Promise<InviteInspection> {
  const code = inviteCodeFromLink(link);

  if (!code) return { state: "invalid" };

  if (Date.now() < inviteCooldownUntil) {
    return { state: "retry" };
  }

  try {
    // Public endpoint: a working invite can be checked
    // even while the bot is offline.
    const response = await fetch(
      `https://discord.com/api/v10/invites/${encodeURIComponent(code)}`,
      {
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (response.status === 404) {
      const error = await response.json();

      return {
        state: error.code === 10006 ? "invalid" : "retry",
      };
    }

    if (response.status === 429) {
      let seconds = Number(
        response.headers.get("retry-after"),
      );

      try {
        const body = await response.json();

        if (typeof body.retry_after === "number") {
          seconds = body.retry_after;
        }
      } catch {
        // Some rate-limit responses are not JSON.
      }

      inviteCooldownUntil =
        Date.now() +
        (Number.isFinite(seconds) && seconds > 0
          ? seconds * 1000
          : MINUTE);

      return { state: "retry" };
    }

    if (!response.ok) {
      return { state: "retry" };
    }

    const invite = await response.json();

    if (invite.guild?.id !== guildId) {
      return { state: "invalid" };
    }

    return {
      state: "valid",
      channelId: invite.channel?.id ?? null,
    };
  } catch {
    // A network failure does not prove the invite is invalid.
    return { state: "retry" };
  }
}

function postingChannel(
  channel: unknown,
): channel is PostingChannel {
  if (
    !channel ||
    typeof channel !== "object" ||
    !("type" in channel)
  ) {
    return false;
  }

  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

function connectionSignature(server: ServerConnection) {
  return JSON.stringify([
    server.discordId,
    server.inviteLink,
    server.welcomeChannelId,
    server.challengeChannelId,
    server.bumpReminders,
    server.isClaimed,
    server.isPublicIndex,
  ]);
}

function selectChannel(
  channels: PostingChannel[],
  configuredId: string | null,
  guild: Guild,
  bot: GuildMember,
  permissions: bigint[],
  preferredId: string | null,
): PostingChannel | null {
  const usable = (channel: PostingChannel) =>
    channel.guild.id === guild.id &&
    channel.permissionsFor(bot)?.has(permissions) === true;

  // Keep an owner's existing choice when it still works.
  const configured = channels.find(
    (channel) =>
      channel.id === configuredId && usable(channel),
  );

  if (configured) return configured;

  // Automatic replacements must be public, non-NSFW
  // ordinary text channels with the required bot permissions.
  const publicChannels = channels.filter(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      !channel.nsfw &&
      usable(channel) &&
      channel
        .permissionsFor(guild.roles.everyone)
        ?.has(PermissionFlagsBits.ViewChannel) === true,
  );

  return (
    publicChannels.find(
      (channel) => channel.id === preferredId,
    ) ??
    publicChannels.find(
      (channel) => channel.id === guild.systemChannelId,
    ) ??
    publicChannels.sort(
      (a, b) =>
        a.rawPosition - b.rawPosition ||
        a.id.localeCompare(b.id),
    )[0] ??
    null
  );
}

export function createConnectionRecovery(
  client: Client,
  dependencies: {
    store?: ConnectionStore;
    inspectInvite?: typeof inspectDiscordInvite;
    now?: () => number;
    log?: (message: string) => void;
  } = {},
) {
  const store = dependencies.store ?? prisma.server;
  const inspectInvite =
    dependencies.inspectInvite ?? inspectDiscordInvite;
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? console.log;

  const inFlight = new Map<
    string,
    Promise<ConnectionResult>
  >();

  const checked = new Map<
    string,
    {
      signature: string;
      expiresAt: number;
      result: ConnectionResult;
    }
  >();

  const failures = new Map<string, number>();
  const lastState = new Map<string, string>();

  function invalidate(serverId: string) {
    checked.delete(serverId);
  }

  async function recover(
    serverId: string,
  ): Promise<ConnectionResult> {
    const server = await store.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      checked.delete(serverId);
      failures.delete(serverId);
      lastState.delete(serverId);

      return {
        state: "blocked",
        inviteLink: null,
        reminderChannelId: null,
      };
    }

    let signature = connectionSignature(server);
    const cached = checked.get(serverId);

    if (
      cached?.signature === signature &&
      cached.expiresAt > now()
    ) {
      return cached.result;
    }

    const inspection = await inspectInvite(
      server.inviteLink,
      server.discordId,
    );

    let inviteLink =
      inspection.state === "valid"
        ? server.inviteLink
        : null;

    let reminderChannelId: string | null = null;
    let welcomeChannelId = server.welcomeChannelId;
    let nextChallengeChannelId =
      server.challengeChannelId;

    let retry = inspection.state === "retry";
    let issue = "";

    const managed =
      server.isClaimed && !server.isPublicIndex;

    if (managed && client.isReady()) {
      try {
        // Fetch current Discord state instead of trusting
        // previously cached channel information.
        const guild = await client.guilds.fetch({
          guild: server.discordId,
          force: true,
        });

        if (!guild.available) {
          throw new Error("Guild temporarily unavailable");
        }

        const [allChannels, bot] = await Promise.all([
          guild.channels.fetch(),
          guild.members.fetchMe({ force: true }),
        ]);

        const channels = [
          ...allChannels.values(),
        ].filter(postingChannel);

        const invitesPaused =
          guild.features.includes(
            GuildFeature.InvitesDisabled,
          ) ||
          (guild.incidentsData?.invitesDisabledUntil?.getTime() ??
            0) > now();

        if (invitesPaused) {
          // Respect invitations deliberately paused by an admin.
          inviteLink = null;
          issue = "invitations paused by the server";
        } else if (inspection.state === "invalid") {
          const welcome = selectChannel(
            channels,
            server.welcomeChannelId,
            guild,
            bot,
            INVITE_PERMISSIONS,
            null,
          );

          if (welcome) {
            try {
              const invite = await welcome.createInvite({
                maxAge: 0,
                maxUses: 0,
                temporary: false,
                unique: false,
                reason:
                  "Restore the Disverz server listing invite",
              });

              welcomeChannelId = welcome.id;
              inviteLink = invite.url;
            } catch (error) {
              const code = discordErrorCode(error);

              retry ||=
                code === undefined ||
                ![10003, 50001, 50013].includes(code);

              issue = `invite creation failed (${code ?? "temporary error"})`;
            }
          } else {
            issue = "no eligible invite channel";
          }
        } else if (
          inspection.state === "valid" &&
          inspection.channelId &&
          !channels.some(
            (channel) =>
              channel.id === server.welcomeChannelId,
          )
        ) {
          // A working invite may already point at a replacement.
          const destination = channels.find(
            (channel) =>
              channel.id === inspection.channelId,
          );

          if (destination) {
            welcomeChannelId = destination.id;
          }
        }

        // Recover reminders separately from invite creation.
        if (server.bumpReminders) {
          reminderChannelId =
            selectChannel(
              channels,
              server.challengeChannelId,
              guild,
              bot,
              REMINDER_PERMISSIONS,
              welcomeChannelId,
            )?.id ?? null;

          if (!reminderChannelId) {
            issue ||= "no eligible reminder channel";
          }
        }

        nextChallengeChannelId =
          reminderChannelId ?? server.challengeChannelId;
      } catch (error) {
        const code = discordErrorCode(error);

        retry ||=
          code === undefined ||
          ![
            10003,
            10004,
            10006,
            50001,
            50013,
          ].includes(code);

        issue = `Discord lookup failed (${code ?? "temporary error"})`;

        // Preserve the listing and owner's preferences.
      }
    }

    const nextInviteLink =
      inviteLink ?? server.inviteLink;

    if (
      welcomeChannelId !== server.welcomeChannelId ||
      nextInviteLink !== server.inviteLink ||
      nextChallengeChannelId !==
        server.challengeChannelId
    ) {
      const data = {
        welcomeChannelId,
        inviteLink: nextInviteLink,
        challengeChannelId: nextChallengeChannelId,
      };

      const update = await store.updateMany({
        // Only update if these settings have not changed
        // while we were waiting for Discord.
        where: {
          id: server.id,
          discordId: server.discordId,
          inviteLink: server.inviteLink,
          welcomeChannelId: server.welcomeChannelId,
          challengeChannelId: server.challengeChannelId,
          bumpReminders: server.bumpReminders,
          isClaimed: server.isClaimed,
          isPublicIndex: server.isPublicIndex,
        },
        data,
      });

      if (!update.count) {
        invalidate(serverId);

        return {
          state: "retry",
          inviteLink: null,
          reminderChannelId: null,
        };
      }

      signature = connectionSignature({
        ...server,
        ...data,
      });

      log(
        `[CONNECTION] Repaired channel/invite configuration for ${server.discordId}`,
      );
    }

    const ready =
      inviteLink !== null &&
      (!managed ||
        !server.bumpReminders ||
        reminderChannelId !== null);

    const result: ConnectionResult = {
      state: ready
        ? "ready"
        : retry
          ? "retry"
          : inviteLink || reminderChannelId
            ? "partial"
            : "blocked",
      inviteLink,
      reminderChannelId,
    };

    const attempt = ready
      ? 0
      : Math.min(
          (failures.get(serverId) ?? 0) + 1,
          5,
        );

    failures.set(serverId, attempt);

    const delay = ready
      ? MINUTE
      : Math.min(
          MINUTE * 2 ** (attempt - 1),
          15 * MINUTE,
        );

    // Bound the size of the process-local caches.
    if (checked.size >= 2000) {
      const oldest = checked.keys().next().value;

      if (oldest) {
        checked.delete(oldest);
        failures.delete(oldest);
        lastState.delete(oldest);
      }
    }

    checked.set(serverId, {
      signature,
      expiresAt: now() + delay,
      result,
    });

    const state =
      `${result.state}:${Boolean(inviteLink)}:` +
      `${Boolean(reminderChannelId)}:${issue}`;

    // Log state changes instead of repeating the same warning.
    if (lastState.get(serverId) !== state) {
      log(
        `[CONNECTION] ${server.discordId}: ${result.state}; ` +
          `invite=${Boolean(inviteLink)}, ` +
          `reminders=${Boolean(reminderChannelId)}` +
          (issue ? `; ${issue}` : ""),
      );

      lastState.set(serverId, state);
    }

    return result;
  }

  function ensure(
    serverId: string,
  ): Promise<ConnectionResult> {
    // Concurrent requests share one recovery operation.
    const pending = inFlight.get(serverId);

    if (pending) return pending;

    const task = recover(serverId).finally(() => {
      inFlight.delete(serverId);
    });

    inFlight.set(serverId, task);
    return task;
  }

  return { ensure, invalidate };
}

export type ConnectionRecovery = ReturnType<
  typeof createConnectionRecovery
>;