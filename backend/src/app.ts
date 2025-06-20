import express from 'express';
import { getPool } from './database/connection';
import { getRedis } from './services/redis';
import { TradingService } from './services/TradingService';
import { XPService } from './services/XPService';

const app = express();
// --- Dependency Injection ---
const pool = getPool();
const redis = getRedis();
const xpService = new XPService(pool, redis);
export const tradingService = new TradingService(xpService); // Export instance for tests
// --------------------------
app.post('/trade', async (req, res) => {
  const success = await tradingService.executeTrade(1, 'BTC');
  if (success) {
    res.status(200).json({ message: 'Trade executed' });
  } else {
    res.status(500).json({ message: 'Trade failed' });
  }
});
export default app;
