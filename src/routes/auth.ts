import { Router, type Request, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import jwt from "jsonwebtoken"; // ADD THIS IMPORT
import dotenv from "dotenv";
import {
  requireAuth,
  type AuthRequest,
} from "../middlewares/authMiddleware.js";

dotenv.config();

const router = Router();

// Route 1: Redirect user to Discord's login page
router.get("/discord/login", (req: Request, res: Response) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(
    process.env.DISCORD_REDIRECT_URI as string,
  );
  const scope = "identify guilds";

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

  res.redirect(discordAuthUrl);
});

// Route 2: Discord Callback
router.get("/discord/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;

  if (!code) {
    res.status(400).json({ error: "No code provided by Discord" });
    return;
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID as string,
      client_secret: process.env.DISCORD_CLIENT_SECRET as string,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI as string,
    });

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      body: params,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const tokenData = await tokenResponse.json();

    // 🛡️ SHIELD 1: Catch Token Errors
    if (!tokenResponse.ok) {
      console.error("❌ DISCORD TOKEN ERROR:", tokenData);
      return res
        .status(400)
        .json({ error: "Discord token rejection", details: tokenData });
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: {
        authorization: `${tokenData.token_type} ${tokenData.access_token}`,
      },
    });
    const userData = await userResponse.json();

    // 🛡️ SHIELD 2: Catch User Fetch Errors
    if (!userResponse.ok) {
      console.error("❌ DISCORD USER ERROR:", userData);
      return res
        .status(400)
        .json({ error: "Discord user data rejection", details: userData });
    }

    // If it gets here, we 100% have valid data. Prisma will NOT crash.
    const user = await prisma.user.upsert({
      where: { discordId: userData.id },
      update: {
        username: userData.username,
        avatar: userData.avatar,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      },
      create: {
        discordId: userData.id,
        username: userData.username,
        avatar: userData.avatar,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      },
    });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" },
    );

    const isProd = process.env.NODE_ENV === 'production';

    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "lax" : "lax", // 'lax' works great now because both share .disverz.com!
      domain: isProd ? ".disverz.com" : undefined, // <--- ADD THIS LINE!
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    console.error("OAuth Error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Route 3: Fetch User's Admin Guilds
router.get("/guilds", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized: Missing user Id" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user || !user.accessToken) {
      res.status(401).json({ error: "Unauthorized or missing access token" });
      return;
    }

    const discordRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: {
        authorization: `Bearer ${user.accessToken}`,
      },
    });

    if (!discordRes.ok) {
      res.status(discordRes.status).json({ error: "Failed to fetch guilds from Discord" });
      return;
    }

    const guilds = await discordRes.json();

    // 1. Filter: Only keep servers where the user is an Admin
    const adminGuilds = guilds.filter((guild: any) => {
      const perms = BigInt(guild.permissions);
      const isAdmin = (perms & BigInt(0x8)) === BigInt(0x8);
      const isManager = (perms & BigInt(0x20)) === BigInt(0x20); 
      return guild.owner || isAdmin || isManager;
    });

    // 👑 2. THE SILENT AUTO-DETECT MAGIC 👑
    // Get all the Discord Server IDs that Zoe is an admin of
    const adminGuildIds = adminGuilds.map((g: any) => g.id);

    // Ask the Database: "Are any of these servers ALREADY listed on Disverz?"
    const alreadyListedServers = await prisma.server.findMany({
      where: { discordId: { in: adminGuildIds } }
    });

    // If they are listed, SILENTLY add Zoe as a manager!
    for (const dbServer of alreadyListedServers) {
      // If she didn't list it herself, and she isn't a manager yet...
      if (dbServer.ownerId !== user.id && !dbServer.managerIds.includes(user.discordId)) {
        await prisma.server.update({
          where: { id: dbServer.id },
          data: { managerIds: { push: user.discordId } }
        });
        console.log(`Auto-assigned ${user.username} as Co-Manager for ${dbServer.name}!`);
      }
    }

    // 3. Return the guilds to the frontend
    res.json(adminGuilds);
  } catch (error) {
    console.error("Fetch Guilds Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Unauthorized: Missing user ID" });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    });

    if (!user) {
      res.status(404).json({ error: "User Not found" });
      return;
    }
    res.json(user);
  } catch (error) {
    console.error("Fetch User Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route 5: Logout User
router.get("/logout", (req: Request, res: Response) => {
  const isProd = process.env.NODE_ENV === "production";
  // 1. Destroy the auth cookie we created during login
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    domain: isProd ? ".disverz.com" : undefined,
  });

  // 2. Send them back to the frontend
  res.redirect((process.env.FRONTEND_URL as string) || "http://localhost:3000");
});

export default router;
