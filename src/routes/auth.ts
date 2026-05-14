import { Router, type Request, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken'; // ADD THIS IMPORT
import dotenv from 'dotenv'

dotenv.config();

const router = Router();
// 2. EXPLICITLY HAND PRISMA THE CLOUD DATABASE URL
const prisma = new PrismaClient();

// ... Route 1 (login) stays exactly the same ...

// Route 2: Discord Callback
router.get('/discord/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;

    if (!code) {
        res.status(400).json({ error: 'No code provided by Discord' });
        return;
    }

    try {
        // ... (Keep the code here exactly the same: fetching token, fetching user, and prisma upsert) ...
        const params = new URLSearchParams({ /* ... */ });
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', { /* ... */ });
        const tokenData = await tokenResponse.json();
        
        const userResponse = await fetch('https://discord.com/api/users/@me', { /* ... */ });
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