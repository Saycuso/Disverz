import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg'; // 1. Import the native pg Pool
import { PrismaPg } from '@prisma/adapter-pg'; // 2. Import the Prisma adapter
import jwt from 'jsonwebtoken'; // ADD THIS IMPORT
import dotenv from 'dotenv'

dotenv.config();

const router = Router();

// 3. Create a connection pool using your cloud database URL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 4. Wrap the pool in the adapter
const adapter = new PrismaPg(pool);

// 5. EXPLICITLY HAND PRISMA THE ADAPTER
const prisma = new PrismaClient({ adapter });

// Route 1: Redirect user to Discord's login page
router.get('/discord/login', (req: Request, res: Response) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI as string);
    const scope = 'identify guilds'; 

    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
    
    res.redirect(discordAuthUrl);
});

// Route 2: Discord Callback
router.get('/discord/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;

    if (!code) {
        res.status(400).json({ error: 'No code provided by Discord' });
        return;
    }

    try {
        // ... (Keep the code here exactly the same: fetching token, fetching user, and prisma upsert) ...
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID as string,
            client_secret: process.env.DISCORD_CLIENT_SECRET as string,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI as string,
        });
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }});
        const tokenData = await tokenResponse.json();
        
        const userResponse = await fetch('https://discord.com/api/users/@me',{
            headers: {
                authorization: `${tokenData.token_type} ${tokenData.access_token}`
            }
        });
        const userData = await userResponse.json();

        const user = await prisma.user.upsert({
            where: { discordId: userData.id },
            update: { username: userData.username, avatar: userData.avatar },
            create: { discordId: userData.id, username: userData.username, avatar: userData.avatar }
        });

        // ==========================================
        // THE NEW BRIDGE LOGIC STARTS HERE
        // ==========================================

        // 1. Sign a secure JWT containing the user's database ID
        const token = jwt.sign(
            { userId: user.id }, 
            process.env.JWT_SECRET as string, 
            { expiresIn: '7d' } // Token expires in 7 days
        );

        // 2. Redirect the browser BACK to the Next.js frontend, attaching the token in the URL
        const frontendRedirectUrl = `${process.env.FRONTEND_URL}/auth-success?token=${token}`;
        
        res.redirect(frontendRedirectUrl);

    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

export default router;