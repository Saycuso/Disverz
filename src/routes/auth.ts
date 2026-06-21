import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import jwt from 'jsonwebtoken'; // ADD THIS IMPORT
import dotenv from 'dotenv'
import {requireAuth, type AuthRequest} from '../middlewares/authMiddleware.js'

dotenv.config();

const router = Router();

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

        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        })
        // 2. Redirect the browser BACK to the Next.js frontend, attaching the token in the URL
        res.redirect(`${process.env.FRONTEND_URL}/dashboard`);

    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

router.get('/me', requireAuth, async(req:AuthRequest, res: Response) => {
    try{
        if (!req.userId) {
    res.status(401).json({ error: "Unauthorized: Missing user ID" });
    return;
}
        const user = await prisma.user.findUnique({
            where: {id: req.userId}
        });

        if(!user){
            res.status(404).json({error: 'User Not found'});
            return;
        }
        res.json(user)
    }
    catch(error){
        console.error('Fetch User Error:', error);
        res.status(500).json({error: 'Internal server error'});
    }
})

export default router;