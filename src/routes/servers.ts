import { Router, type Response, type Request } from "express";
import {
  requireAuth,
  type AuthRequest,
} from "../middlewares/authMiddleware.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

// ==========================================
// 1. REGISTER SERVER (Protected)
// ==========================================
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      discordId,
      name,
      description,
      welcomeChannelId,
      category,
      tags,
      iconUrl,
    } = req.body;

    if (!discordId || !name || !description || !welcomeChannelId) {
      res.status(400).json({ error: "Missing required server fields" });
      return;
    }

    const existingServer = await prisma.server.findUnique({
      where: { discordId },
    });

    if (existingServer) {
      res
        .status(409)
        .json({ error: "This server is already registered on Disverz" });
      return;
    }

    // 👑 2. The Auto-Invite Generator
    let finalInviteLink = "https://discord.gg/pending"; // Fallback just in case

    try {
      const discordRes = await fetch(
        `https://discord.com/api/v10/channels/${welcomeChannelId}/invites`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            max_age: 0,
            max_uses: 0,
          }),
        },
      );
      if (discordRes.ok) {
        const inviteData = await discordRes.json();
        finalInviteLink = `https://discord.gg/${inviteData.code}`;
      } else {
        console.error(
          "Discord API rejected invite creation. Check bot permissions in that channel.",
        );
      }
    } catch (error) {
      console.error("Network error while generating invite:", error);
    }

    const newServer = await prisma.server.create({
      data: {
        discordId,
        name,
        description,
        inviteLink: finalInviteLink,
        category: category || "general",
        tags: tags || [],
        iconUrl: iconUrl || null,
        welcomeChannelId: welcomeChannelId,
        ownerId: req.userId as string,
      },
    });

    res.status(201).json(newServer);
  } catch (error) {
    console.error("Server Registration Error:", error);
    res.status(500).json({ error: "Failed to register server" });
  }
});

// ==========================================
// UPDATE SERVER (The Forge)
// ==========================================
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.id as string;
    const {
      description,
      tags,
      category,
      language,
      welcomeChannelId,
      challengeChannelId,
    } = req.body;
    

    // 1. Verify the server exists AND the requester is the owner
    const existingServer = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!existingServer) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    if (existingServer.ownerId !== req.userId) {
      res
        .status(403)
        .json({ error: "You do not have permission to edit this server" });
      return;
    }

    // 2. If Welcome Channel changed, forge a new Discord Invite
    let finalInviteLink = existingServer.inviteLink;

    if (
      welcomeChannelId &&
      welcomeChannelId !== existingServer.welcomeChannelId
    ) {
      try {
        const discordRes = await fetch(
          `https://discord.com/api/v10/channels/${welcomeChannelId}/invites`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ max_age: 0, max_uses: 0 }),
          },
        );

        if (discordRes.ok) {
          const inviteData = await discordRes.json();
          finalInviteLink = `https://discord.gg/${inviteData.code}`;
        } else {
          console.warn("Discord API rejected invite creation during edit.");
        }
      } catch (error) {
        console.error("Network error forging new invite:", error);
      }
    }

    // 3. Update the database
    const updatedServer = await prisma.server.update({
      where: { id: serverId },
      data: {
        description,
        tags,
        category,
        language,
        welcomeChannelId,
        challengeChannelId,
        inviteLink: finalInviteLink,
      },
    });

    res.json(updatedServer);
  } catch (error) {
    console.error("Update Server Error:", error);
    res.status(500).json({ error: "Failed to update server" });
  }
});

// ==========================================
// 2. FETCH SERVERS (The Dual-Tab Engine)
// ==========================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const sort = (req.query.sort as string) || "active"; // Default to V1 Active feed

    const baseWhere = {
      isDormant: false,
      ...(category && { category }),
      ...(search && {
        name: { contains: search, mode: "insensitive" as const },
      }),
    };

    // --- ACTIVE TAB: Chronological Bump ---
    if (sort === "active") {
      const [servers, total] = await Promise.all([
        prisma.server.findMany({
          where: baseWhere,
          include: { owner: { select: { username: true, avatar: true } } },
          orderBy: { lastChallengeAt: "desc" }, // Native DB chronological sort
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.server.count({ where: baseWhere }),
      ]);

      res.json({
        data: servers,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          feed: "active",
        },
      });
      return;
    }

    // --- RANKED TAB: Math Decay Engine (For V2) ---
    if (sort === "ranked") {
      const servers = await prisma.server.findMany({
        where: baseWhere,
        include: { owner: { select: { username: true, avatar: true } } },
      });

      const now = Date.now();
      const rankedServers = servers.map((server: any) => {
        let displayScore = 0;
        if (server.lastChallengeAt) {
          const daysPassed =
            (now - server.lastChallengeAt.getTime()) / (1000 * 60 * 60 * 24);
          const decayRate = 0.08;
          displayScore = server.rawScore * Math.exp(-decayRate * daysPassed);
        }
        return {
          ...server,
          displayScore: parseFloat(displayScore.toFixed(2)),
        };
      });

      rankedServers.sort((a: any, b: any) => b.displayScore - a.displayScore);
      const startIndex = (page - 1) * limit;
      const paginated = rankedServers.slice(startIndex, startIndex + limit);

      res.json({
        data: paginated,
        meta: {
          total: rankedServers.length,
          page,
          limit,
          totalPages: Math.ceil(rankedServers.length / limit),
          feed: "ranked",
        },
      });
      return;
    }

    res
      .status(400)
      .json({ error: 'Invalid sort parameter. Use "active" or "ranked".' });
  } catch (error) {
    console.error("Fetch Servers Error:", error);
    res.status(500).json({ error: "Failed to fetch server list" });
  }
});

// ==========================================
// 3. FETCH SINGLE SERVER DETAILS (Math-Free V1)
// ==========================================
interface serverparams {
  id: string;
}

// ==========================================
// FETCH USER'S MANAGED SERVERS (The Armory)
// ==========================================
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Query PostgreSQL for servers matching the logged-in user's ID
    const myServers = await prisma.server.findMany({
      where: { ownerId: req.userId as string },
      orderBy: { createdAt: "desc" }, // Newest first
    });

    res.json(myServers);
  } catch (error) {
    console.error("Fetch My Servers Error:", error);
    res.status(500).json({ error: "Failed to fetch your servers" });
  }
});

router.get("/:id", async (req: Request<serverparams>, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { username: true, avatar: true } },
        challenges: {
          orderBy: { postedAt: "desc" }, // EXACT FIX: Using your custom postedAt column
          take: 10, // Only fetch the last 10 challenges so the page loads instantly
        },
      },
    });

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    // V1 Reality: We just return the raw server data. No decay math.
    // The frontend only cares about 'lastChallengeAt' to show when they were last active.
    res.json(server);
  } catch (error) {
    console.error("Single Server Fetch Error:", error);
    res.status(500).json({ error: "Failed to fetch server" });
  }
});

// ==========================================
// 4. JOIN SERVER (Conversion Tracking)
// ==========================================
router.get("/:id/join", async (req: Request<serverparams>, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: req.params.id },
    });

    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    // Secure database transaction to log both analytics and profile stats
    await prisma.$transaction([
      prisma.joinClick.create({
        data: { serverId: server.id },
      }),
      prisma.server.update({
        where: { id: server.id },
        // Make sure you have joinCount in your Server schema, otherwise remove this update block
        data: { joinCount: { increment: 1 } },
      }),
    ]);

    // Redirect to Discord invite
    res.redirect(server.inviteLink);
  } catch (error) {
    console.error("Join Tracking Error:", error);
    res.status(500).json({ error: "Failed to process join" });
  }
});

// Route: Fetch Text Channels for a specific guild (Requires Bot Token)
router.get(
  "/:id/channels",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const guildId = req.params.id;

      // Use the Bot Token to ask Discord for the channels
      const response = await fetch(
        `https://discord.com/api/guilds/${guildId}/channels`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          },
        },
      );

      if (!response.ok) {
        return res
          .status(400)
          .json({ error: "Bot lacks permissions or is not in the server." });
      }

      const channels = await response.json();

      // Filter: We only want Text Channels (type 0) and Announcement Channels (type 5)
      // We also ensure the bot has permission to view them, but for now, filtering by type is enough.
      const textChannels = channels.filter(
        (c: any) => c.type === 0 || c.type === 5,
      );

      res.json(textChannels);
    } catch (error) {
      console.error("Fetch Channels Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ==========================================
// DELETE SERVER (The Kill Switch)
// ==========================================
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.id as string;

    // 1. Verify the server exists
    const existingServer = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!existingServer) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    // 2. Verify Authorization (Only the owner can delete it)
    if (existingServer.ownerId !== req.userId) {
      res
        .status(403)
        .json({ error: "You do not have permission to delete this server" });
      return;
    }

    // 3. Wipe it from existence (Prisma Cascade will handle related Challenges/JoinClicks if configured in schema)
    await prisma.server.delete({
      where: { id: serverId },
    });

    res.json({
      message: "Server successfully removed from the Disverz pulse.",
    });
  } catch (error) {
    console.error("Delete Server Error:", error);
    res.status(500).json({ error: "Failed to delete server" });
  }
});

// ==========================================
// WEB BUMP: TURNSTILE VERIFY & EXECUTE BUMP
// ==========================================
router.post("/:id/web-bump", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const serverId = req.params.id as string;
    const { token } = req.body;
    
    if (!token) {
        res.status(400).json({ error: "Missing Turnstile token." });
        return;
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    // Cooldown Strategy (2 Hours)
    const COOLDOWN_HOURS = 2;
    if (server.lastChallengeAt) {
      const hoursSinceLast = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < COOLDOWN_HOURS) {
        const minutesLeft = Math.ceil((COOLDOWN_HOURS - hoursSinceLast) * 60);
        res.status(429).json({ error: `Cooldown. Next bump in ${minutesLeft} minutes.` });
        return;
      }
    }

    // Verify Token with Cloudflare
    const formData = new URLSearchParams();
    formData.append('secret', process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY as string);
    formData.append('response', token);

    const cloudflareRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData
    });
    const cloudflareData = await cloudflareRes.json();

    if (!cloudflareData.success) {
        res.status(400).json({ error: "Human verification failed. Please try again." });
        return;
    }

    // Success! Execute the bump
    await prisma.server.update({
      where: { id: server.id },
      data: {
        lastChallengeAt: new Date(),
        isDormant: false,
      }
    });

    res.json({ message: "Server successfully bumped to the top of the active feed!" });
  } catch (error) {
    console.error("Web Bump Error:", error);
    res.status(500).json({ error: "Failed to bump server" });
  }
});

// // ==========================================
// // 5. WEB BUMP: FETCH TRIVIA CAPTCHA
// // ==========================================
// router.get("/:id/web-challenge", requireAuth, async (req: AuthRequest, res: Response) => {
//   try {
//     const serverId = req.params.id as string; // 👑 FIX: Cast to string
//     const server = await prisma.server.findUnique({ where: { id: serverId } });
    
//     if (!server) {
//       res.status(404).json({ error: "Server not found" });
//       return;
//     }

//     // Cooldown Strategy (2 Hours)
//     const COOLDOWN_HOURS = 2;
//     if (server.lastChallengeAt) {
//       const hoursSinceLast = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60);
//       if (hoursSinceLast < COOLDOWN_HOURS) {
//         const minutesLeft = Math.ceil((COOLDOWN_HOURS - hoursSinceLast) * 60);
//         res.status(429).json({ error: `Cooldown, The Next challenge in ${minutesLeft} minutes.` });
//         return;
//       }
//     }
//     const targetCategory = server.category.toLowerCase();
//     // Fetch the Weapon
//     const questions = await prisma.$queryRaw<Array<{
//       id: string; category: string; text: string; answer: string;
//     }>>`
//       SELECT * FROM "Question"
//       WHERE LOWER(category) = ${targetCategory}
//       ORDER BY RANDOM()
//       LIMIT 1
//     `;

//     // 👑 FIX: Explicitly check the object itself to satisfy TypeScript
//     const question = questions[0];
//     if (!question) {
//       res.status(404).json({ error: "No questions found for this category." });
//       return;
//     }

//     const parts = question.text.split('|');
    
//     let displayMessage = question.text;
//     let options: { id: string; text: string }[] = [];

//     if (parts.length === 5) {
//       // 👑 FIX: Tell TypeScript "I promise these are strings because length is 5"
//       displayMessage = parts[0] as string;
//       options = [
//         { id: "A", text: parts[1] as string },
//         { id: "B", text: parts[2] as string },
//         { id: "C", text: parts[3] as string },
//         { id: "D", text: parts[4] as string }
//       ];
//     }

//     // Log the challenge in the database so we can verify the answer later
//     const challenge = await prisma.challenge.create({
//       data: {
//         serverId: server.id,
//         questionId: question.id,
//       }
//     });

//     res.json({
//       challengeId: challenge.id,
//       text: displayMessage,
//       options
//     });
//   } catch (error) {
//     console.error("Web Challenge Fetch Error:", error);
//     res.status(500).json({ error: "Failed to initialize web challenge" });
//   }
// });

// // ==========================================
// // 6. WEB BUMP: VERIFY & EXECUTE BUMP
// // ==========================================
// router.post("/:id/web-challenge", requireAuth, async (req: AuthRequest, res: Response) => {
//   try {
//     const serverId = req.params.id as string; // 👑 FIX: Cast to string
//     const { challengeId, answer } = req.body;
    
//     const challenge = await prisma.challenge.findUnique({
//       where: { id: challengeId as string },
//       include: { question: true, server: true }
//     });

//     if (!challenge || challenge.serverId !== serverId) {
//        res.status(400).json({ error: "Invalid challenge session." });
//        return;
//     }

//     // Check if the human chose the right answer
//     if (challenge.question.answer.trim().toUpperCase() !== (answer as string).trim().toUpperCase()) {
//        res.status(400).json({ error: "Incorrect answer. Bump failed." });
//        return;
//     }

//     // Success! Execute the bump transaction
//     await prisma.$transaction([
//       prisma.challenge.update({
//         where: { id: challenge.id },
//         data: {
//           answeredByUserId: req.userId as string,
//           answeredAt: new Date(),
//           isValid: true,
//         }
//       }),
//       prisma.server.update({
//         where: { id: challenge.serverId },
//         data: {
//           lastChallengeAt: new Date(),
//           isDormant: false,
//         }
//       })
//     ]);

//     res.json({ message: "Server successfully bumped to the top of the active feed!" });
//   } catch (error) {
//     console.error("Web Challenge Verify Error:", error);
//     res.status(500).json({ error: "Failed to verify challenge" });
//   }
// });



 export default router;
