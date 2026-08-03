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

const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const allowedOrigins = [
  frontendUrl,
  'https://disverz.com',
  'https://www.disverz.com',
  'http://localhost:3000',
  'chrome-extension://cbfeabmcldkkohfkdjaclonghkliehbm'
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, postman, or server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 👑 ADD THIS CONSOLE LOG TO SEE THE EXACT BLOCKED PORT
      console.error(`🚨 CORS BLOCKED THIS EXACT ORIGIN: ${origin}`);
      callback(new Error('Blocked by CORS'));
    }
  },
  credentials: true, // 👑 CRITICAL: Tells Express to accept and send cookies
}));
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes)

app.get('/', (req: Request, res: Response) => {
    res.json({message: 'Disverz API is live and breathing.'});
})

app.listen(PORT, ()=> {
    console.log(`[SERVER] Disverz API running on the ${PORT}`)
    startBot();
});

