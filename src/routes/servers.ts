import { Router, type Response, type Request } from 'express';
import { requireAuth, type AuthRequest } from '../middlewares/authMiddleware.js';
import { prisma } from '../lib/prisma.js';

const router = Router();

// Route: Register a new server
// Protected by requireAuth - only logged-in users can access this
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
        const { discordId, name, description, inviteLink, category, tags, iconUrl } = req.body;

        // 1. Basic validation (Ensure required fields are present)
        if (!discordId || !name || !description || !inviteLink) {
             res.status(400).json({ error: 'Missing required server fields' });
             return;
        }

        // 2. Check if the server already exists to prevent duplicates
        const existingServer = await prisma.server.findUnique({
            where: { discordId }
        });

        if (existingServer) {
             res.status(409).json({ error: 'This server is already registered on Disverz' });
             return;
        }
        
        
        // 3. Insert the server into the database, linking it to the logged-in user
        const newServer = await prisma.server.create({
            data: {
                discordId,
                name,
                description,
                inviteLink,
                category: category || 'general',
                tags: tags || [],
                iconUrl: iconUrl || null,
                // req.userId comes directly from your secure JWT middleware
                ownerId: req.userId as string, 
            }
        });

        res.status(201).json(newServer);
    } catch (error) {
        console.error('Server Registration Error:', error);
        res.status(500).json({ error: 'Failed to register server' });
    }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;

    const servers = await prisma.server.findMany({
      where: {
        ...(category && { category }),
        ...(search && {
          name: { contains: search, mode: 'insensitive' }
        })
      },
      include: {
        owner: { select: { username: true, avatar: true } }
      }
    });

    const now = Date.now();

    const rankedServers = servers.map(server => {
      let displayScore = 0;

      if (server.lastChallengeAt) {
        const daysPassed = (now - server.lastChallengeAt.getTime()) / (1000 * 60 * 60 * 24);
        const decayRate = server.isDormant ? 0.25 : 0.08;
        displayScore = server.rawScore * Math.exp(-decayRate * daysPassed);
      }

      return {
        ...server,
        displayScore: parseFloat(displayScore.toFixed(2))
      };
    });

    rankedServers.sort((a, b) => b.displayScore - a.displayScore);

    const startIndex = (page - 1) * limit;
    const paginated = rankedServers.slice(startIndex, startIndex + limit);

    res.json({
      data: paginated,
      meta: {
        total: rankedServers.length,
        page,
        limit,
        totalPages: Math.ceil(rankedServers.length / limit)
      }
    });

  } catch (error) {
    console.error('Fetch Servers Error:', error);
    res.status(500).json({ error: 'Failed to fetch server ranking list' });
  }
});

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
          orderBy: { postedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Compute displayScore on read
    let displayScore = 0;
    if (server.lastChallengeAt) {
      const daysPassed = (Date.now() - server.lastChallengeAt.getTime()) / (1000 * 60 * 60 * 24);
      const decayRate = server.isDormant ? 0.25 : 0.08;
      displayScore = server.rawScore * Math.exp(-decayRate * daysPassed);
    }

    res.json({
      ...server,
      displayScore: parseFloat(displayScore.toFixed(2))
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

router.get('/:id/join', async (req: Request<serverparams>, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: req.params.id }
    });

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Log the click
    await prisma.joinClick.create({
      data: { serverId: server.id }
    });

    // Redirect to Discord invite
    res.redirect(server.inviteLink);

  } catch (error) {
    res.status(500).json({ error: 'Failed to process join' });
  }
});

export default router;