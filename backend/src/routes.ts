import { Router, Request, Response } from 'express';
import { tradingService } from './services/TradingService';
import { leaderboardService } from './services/LeaderboardService';
import logger from './utils/logger';

const router = Router();

/**
 * @route GET /health
 * @description Health check endpoint to verify the service is running.
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'UP' });
});

/**
 * @route POST /trade
 * @description Endpoint to initiate a trade.
 * @body { userId: number, asset: string, type: 'long' | 'short', size: number, mode: 'mock' | 'live' }
 */
router.post('/trade', async (req: Request, res: Response) => {
  const { userId, asset, type, size, mode } = req.body;

  // Basic validation
  if (!userId || !asset || !type || !size || !mode) {
    return res.status(400).json({ message: 'Missing required trade parameters.' });
  }

  try {
    const success = await tradingService.executeTrade(userId, asset, type, size, mode);
    if (success) {
      res.status(200).json({ message: 'Trade executed successfully.' });
    } else {
      res.status(500).json({ message: 'Trade execution failed.' });
    }
  } catch (error) {
    logger.error('Error in /trade endpoint:', error);
    res.status(500).json({ message: 'An internal error occurred while processing the trade.' });
  }
});

/**
 * @route GET /leaderboard/:type
 * @description Fetches the specified leaderboard.
 * @param {string} type - 'global', 'weekly', or 'monthly'.
 */
router.get('/leaderboard/:type', async (req: Request, res: Response) => {
    const { type } = req.params;
    const { limit = '100' } = req.query;

    if (type !== 'global' && type !== 'weekly' && type !== 'monthly') {
        return res.status(400).json({ message: "Invalid leaderboard type. Must be 'global', 'weekly', or 'monthly'." });
    }
    
    try {
        const leaderboard = await leaderboardService.getLeaderboard(type, parseInt(limit as string, 10));
        res.status(200).json(leaderboard);
    } catch (error) {
        logger.error(`Error fetching ${type} leaderboard:`, error);
        res.status(500).json({ message: 'Failed to fetch leaderboard.' });
    }
});


export default router;
