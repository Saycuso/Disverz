import express, {type Request, type Response} from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/auth.js'; // 1. IMPORT THE AUTH ROUTER
import serverRoutes from './routes/servers.js'
import cookieParser from 'cookie-parser';
import { startBot } from './bot/bot.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes)

app.get('/', (req: Request, res: Response) => {
    res.json({message: 'Disverz API is live and breathing.'});
})

app.listen(PORT, ()=> {
    console.log(`[SERVER] Disverz API running on the http://localhost:${PORT}`)
    startBot();
});

