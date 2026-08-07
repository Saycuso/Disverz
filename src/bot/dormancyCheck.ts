import { prisma } from '../lib/prisma.js'

// ==========================================
// 🛠️ DEV / TEST MODE (Uncomment to test quickly)
// ==========================================
// const DORMANCY_THRESHOLD_MS = 30 * 1000; // 30 seconds
// const CHECK_INTERVAL_MS = 10 * 1000;     // 10 seconds

// ==========================================
// 🚀 PRODUCTION MODE (Active)
// ==========================================
const DORMANCY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days
const CHECK_INTERVAL_MS = 60 * 60 * 1000;               // 1 Hour

export function startDormancyCheck() {
  setInterval(async () => {
    try {
      // Calculate the exact time 30 seconds ago
      const cutoff = new Date(Date.now() - DORMANCY_THRESHOLD_MS);

      const result = await prisma.server.updateMany({
        where: {
          isDormant: false,
          OR: [
            { lastHumanMsgAt: { lt: cutoff } }, // Message is older than 30 seconds
            { lastHumanMsgAt: null }            // Or they literally never spoke
          ]
        },
        data: {
          isDormant: true
        }
      });

      if (result.count > 0) {
        console.log(`[VITALS] 💀 Flatline detected. Marked ${result.count} server(s) as dormant.`);
      }
    } catch (error) {
      console.error('Dormancy Check Error:', error);
    }
  }, CHECK_INTERVAL_MS);

  console.log('[VITALS] Heartbeat monitor running...');
}