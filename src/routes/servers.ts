import { Router, type Response, type Request } from 'express';
import { requireAuth, type AuthRequest } from '../middlewares/authMiddleware.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// ==========================================
// 1. REGISTER SERVER (Protected)
// ==========================================
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { discordId, name, description, inviteLink, category, tags, iconUrl } = req.body;

        if (!discordId || !name || !description || !inviteLink) {
             res.status(400).json({ error: 'Missing required server fields' });
             return;
        }

        const existingServer = await prisma.server.findUnique({
            where: { discordId }
        });

        if (existingServer) {
             res.status(409).json({ error: 'This server is already registered on Disverz' });
             return;
        }
        
        const newServer = await prisma.server.create({
            data: {
                discordId,
                name,
                description,
                inviteLink,
                category: category || 'general',
                tags: tags || [],
                iconUrl: iconUrl || null,
                ownerId: req.userId as string, 
            }
        });

        res.status(201).json(newServer);
    } catch (error) {
        console.error('Server Registration Error:', error);
        res.status(500).json({ error: 'Failed to register server' });
    }
});

// ==========================================
// 2. FETCH SERVERS (The Dual-Tab Engine)
// ==========================================
router.get('/', async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const category = req.query.category as string | undefined;
        const search = req.query.search as string | undefined;
        const sort = (req.query.sort as string) || 'active'; // Default to V1 Active feed

        const baseWhere = {
            isDormant: false,
            ...(category && { category }),
            ...(search && {
                name: { contains: search, mode: 'insensitive' as const }
            })
        };

        // --- ACTIVE TAB: Chronological Bump ---
        if (sort === 'active') {
            const [servers, total] = await Promise.all([
                prisma.server.findMany({
                    where: baseWhere,
                    include: { owner: { select: { username: true, avatar: true } } },
                    orderBy: { lastChallengeAt: 'desc' }, // Native DB chronological sort
                    skip: (page - 1) * limit,
                    take: limit
                }),
                prisma.server.count({ where: baseWhere })
            ]);

            res.json({
                data: servers,
                meta: { total, page, limit, totalPages: Math.ceil(total / limit), feed: 'active' }
            });
            return;
        }

        // --- RANKED TAB: Math Decay Engine (For V2) ---
        if (sort === 'ranked') {
            const servers = await prisma.server.findMany({
                where: baseWhere,
                include: { owner: { select: { username: true, avatar: true } } }
            });

            const now = Date.now();
            const rankedServers = servers.map((server:any) => {
                let displayScore = 0;
                if (server.lastChallengeAt) {
                    const daysPassed = (now - server.lastChallengeAt.getTime()) / (1000 * 60 * 60 * 24);
                    const decayRate = 0.08; 
                    displayScore = server.rawScore * Math.exp(-decayRate * daysPassed);
                }
                return {
                    ...server,
                    displayScore: parseFloat(displayScore.toFixed(2))
                };
            });

            rankedServers.sort((a: any, b: any) => b.displayScore - a.displayScore);
            const startIndex = (page - 1) * limit;
            const paginated = rankedServers.slice(startIndex, startIndex + limit);

            res.json({
                data: paginated,
                meta: { total: rankedServers.length, page, limit, totalPages: Math.ceil(rankedServers.length / limit), feed: 'ranked' }
            });
            return;
        }

        res.status(400).json({ error: 'Invalid sort parameter. Use "active" or "ranked".' });

    } catch (error) {
        console.error('Fetch Servers Error:', error);
        res.status(500).json({ error: 'Failed to fetch server list' });
    }
});

// ==========================================
// 3. FETCH SINGLE SERVER DETAILS (Math-Free V1)
// ==========================================
interface serverparams {
  id: string
}

router.get('/:id', async (req: Request<serverparams>, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { username: true, avatar: true } },
        challenges: {
          orderBy: { postedAt: 'desc' }, // EXACT FIX: Using your custom postedAt column
          take: 10 // Only fetch the last 10 challenges so the page loads instantly
        }
      }
    });

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // V1 Reality: We just return the raw server data. No decay math. 
    // The frontend only cares about 'lastChallengeAt' to show when they were last active.
    res.json(server);

  } catch (error) {
    console.error('Single Server Fetch Error:', error);
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// ==========================================
// 4. JOIN SERVER (Conversion Tracking)
// ==========================================
router.get('/:id/join', async (req: Request<serverparams>, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: req.params.id }
    });

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Secure database transaction to log both analytics and profile stats
    await prisma.$transaction([
        prisma.joinClick.create({
            data: { serverId: server.id }
        }),
        prisma.server.update({
            where: { id: server.id },
            // Make sure you have joinCount in your Server schema, otherwise remove this update block
            data: { joinCount: { increment: 1 } } 
        })
    ]);

    // Redirect to Discord invite
    res.redirect(server.inviteLink);

  } catch (error) {
    console.error('Join Tracking Error:', error);
    res.status(500).json({ error: 'Failed to process join' });
  }
});

export default router;