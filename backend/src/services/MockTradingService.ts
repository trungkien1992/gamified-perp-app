import { getPool } from '../database/connection';
import { getRedis } from './redis';
import { logger } from '../utils/logger';
import { WebSocketService } from './WebSocketService';
import { XPService } from './XPService';
import axios from 'axios';

interface MockTradeParams {
  userId: number;
  asset: string;
  direction: 'long' | 'short';
  size: number;
  leverage?: number;
}

interface PriceSimulation {
  asset: string;
  basePrice: number;
  volatility: number;
  trend: number;
  lastUpdate: Date;
}

interface MockPosition {
  id: number;
  userId: number;
  asset: string;
  direction: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercentage: number;
  status: 'open' | 'closed';
  openedAt: Date;
  closedAt?: Date;
}

export class MockTradingService {
  private static instance: MockTradingService;
  private priceSimulations: Map<string, PriceSimulation> = new Map();
  private priceUpdateInterval: NodeJS.Timer;
  private positionUpdateInterval: NodeJS.Timer;
  private redis = getRedis();
  
  // Configuration
  private readonly PRICE_UPDATE_FREQUENCY = 1000; // 1 second
  private readonly POSITION_UPDATE_FREQUENCY = 5000; // 5 seconds
  private readonly MAX_MOCK_POSITIONS = 5;
  private readonly MOCK_XP_MULTIPLIER = 0.3; // 30% of real XP
  private readonly AUTO_CLOSE_TIME = 300000; // 5 minutes
  
  // Realistic price ranges and volatilities
  private readonly ASSET_CONFIG = {
    BTC: { basePrice: 45000, volatility: 0.02, dailyVolume: 25000000000 },
    ETH: { basePrice: 2500, volatility: 0.025, dailyVolume: 15000000000 },
    SOL: { basePrice: 100, volatility: 0.04, dailyVolume: 2000000000 },
    DOGE: { basePrice: 0.15, volatility: 0.06, dailyVolume: 1000000000 },
    PEPE: { basePrice: 0.0000012, volatility: 0.1, dailyVolume: 500000000 },
  };
  
  private constructor() {
    this.initializePriceSimulations();
    this.startPriceUpdates();
    this.startPositionUpdates();
  }
  
  static getInstance(): MockTradingService {
    if (!this.instance) {
      this.instance = new MockTradingService();
    }
    return this.instance;
  }
  
  private initializePriceSimulations() {
    Object.entries(this.ASSET_CONFIG).forEach(([asset, config]) => {
      this.priceSimulations.set(asset, {
        asset,
        basePrice: config.basePrice,
        volatility: config.volatility,
        trend: 0,
        lastUpdate: new Date(),
      });
    });
  }
  
  private startPriceUpdates() {
    this.priceUpdateInterval = setInterval(() => {
      this.updatePrices();
    }, this.PRICE_UPDATE_FREQUENCY);
  }
  
  private startPositionUpdates() {
    this.positionUpdateInterval = setInterval(() => {
      this.updateOpenPositions();
    }, this.POSITION_UPDATE_FREQUENCY);
  }
  
  private updatePrices() {
    for (const [asset, simulation] of this.priceSimulations) {
      const now = new Date();
      const timeDiff = (now.getTime() - simulation.lastUpdate.getTime()) / 1000;
      
      // Random walk with mean reversion
      const randomChange = (Math.random() - 0.5) * simulation.volatility;
      const trendAdjustment = -simulation.trend * 0.1; // Mean reversion
      const marketSentiment = Math.sin(now.getTime() / 60000) * 0.001; // Sine wave for market cycles
      
      simulation.trend += randomChange + trendAdjustment;
      simulation.trend = Math.max(-0.1, Math.min(0.1, simulation.trend)); // Limit trend
      
      // Calculate new price
      const priceChange = simulation.basePrice * (randomChange + simulation.trend * timeDiff + marketSentiment);
      simulation.basePrice = Math.max(
        simulation.basePrice * 0.9, // Max 10% drop
        Math.min(
          simulation.basePrice * 1.1, // Max 10% gain
          simulation.basePrice + priceChange
        )
      );
      
      simulation.lastUpdate = now;
      
      // Publish price update
      this.publishPriceUpdate(asset, simulation.basePrice);
    }
  }
  
  private async publishPriceUpdate(asset: string, price: number) {
    // Store in Redis for quick access
    await this.redis.hset('mock_prices', asset, price.toString());
    
    // Broadcast to subscribers
    WebSocketService.getInstance().broadcast({
      type: 'price_update',
      data: {
        asset,
        price,
        timestamp: Date.now(),
        isMock: true,
      }
    });
  }
  
  async executeMockTrade(params: MockTradeParams): Promise<MockPosition> {
    const pool = getPool();
    
    try {
      // Check user limits
      await this.checkUserLimits(params.userId);
      
      // Get current price
      const currentPrice = this.getCurrentPrice(params.asset);
      
      // Create position
      const result = await pool.query(
        `INSERT INTO trades (
          user_id, asset, direction, size, entry_price, 
          status, is_mock, opened_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          params.userId,
          params.asset,
          params.direction,
          params.size,
          currentPrice,
          'open',
          true,
          new Date()
        ]
      );
      
      const position = this.mapToMockPosition(result.rows[0]);
      
      // Award reduced XP for mock trades
      await this.awardMockXP(params.userId, 'mock_trade_opened', {
        asset: params.asset,
        size: params.size,
      });
      
      // Send confirmation
      this.notifyTradeExecution(params.userId, position);
      
      // Schedule auto-close
      this.scheduleAutoClose(position.id, params.userId);
      
      // Add tutorial hints for new users
      await this.checkAndSendTutorialHints(params.userId, position);
      
      return position;
      
    } catch (error) {
      logger.error('Mock trade execution failed:', error);
      throw error;
    }
  }
  
  private async checkUserLimits(userId: number) {
    const pool = getPool();
    
    // Check open positions count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count 
       FROM trades 
       WHERE user_id = $1 AND is_mock = true AND status = 'open'`,
      [userId]
    );
    
    if (parseInt(countResult.rows[0].count) >= this.MAX_MOCK_POSITIONS) {
      throw new Error(`Maximum ${this.MAX_MOCK_POSITIONS} mock positions allowed`);
    }
    
    // Check daily mock trade limit
    const dailyResult = await pool.query(
      `SELECT COUNT(*) as count 
       FROM trades 
       WHERE user_id = $1 
         AND is_mock = true 
         AND opened_at >= CURRENT_DATE`,
      [userId]
    );
    
    if (parseInt(dailyResult.rows[0].count) >= 50) {
      throw new Error('Daily mock trade limit reached (50 trades)');
    }
  }
  
  private getCurrentPrice(asset: string): number {
    const simulation = this.priceSimulations.get(asset);
    if (!simulation) {
      throw new Error(`Unknown asset: ${asset}`);
    }
    return simulation.basePrice;
  }
  
  private async updateOpenPositions() {
    const pool = getPool();
    
    try {
      // Get all open mock positions
      const result = await pool.query(
        `SELECT * FROM trades 
         WHERE is_mock = true AND status = 'open'`
      );
      
      const updates: MockPosition[] = [];
      
      for (const row of result.rows) {
        const currentPrice = this.getCurrentPrice(row.asset);
        const pnl = this.calculatePnL(row, currentPrice);
        
        // Update position in database
        await pool.query(
          `UPDATE trades 
           SET current_price = $1, pnl = $2 
           WHERE id = $3`,
          [currentPrice, pnl.amount, row.id]
        );
        
        const position = this.mapToMockPosition({
          ...row,
          current_price: currentPrice,
          pnl: pnl.amount,
        });
        
        updates.push(position);
        
        // Check for stop loss / take profit
        await this.checkAutoCloseConditions(position);
      }
      
      // Broadcast position updates
      this.broadcastPositionUpdates(updates);
      
    } catch (error) {
      logger.error('Failed to update mock positions:', error);
    }
  }
  
  private calculatePnL(
    position: any,
    currentPrice: number
  ): { amount: number; percentage: number } {
    const priceChange = currentPrice - position.entry_price;
    const direction = position.direction === 'long' ? 1 : -1;
    
    const pnlAmount = (priceChange * direction * position.size) / position.entry_price;
    const pnlPercentage = (priceChange / position.entry_price) * 100 * direction;
    
    return {
      amount: pnlAmount,
      percentage: pnlPercentage,
    };
  }
  
  private async checkAutoCloseConditions(position: MockPosition) {
    // Auto close at ±20% PnL (mock trading protection)
    if (Math.abs(position.pnlPercentage) >= 20) {
      await this.closeMockPosition(position.id, position.userId, 'auto_limit');
    }
  }
  
  async closeMockPosition(
    positionId: number,
    userId: number,
    reason: 'manual' | 'auto_timeout' | 'auto_limit' = 'manual'
  ): Promise<MockPosition> {
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get current position
      const positionResult = await client.query(
        'SELECT * FROM trades WHERE id = $1 AND user_id = $2 AND is_mock = true',
        [positionId, userId]
      );
      
      if (positionResult.rows.length === 0) {
        throw new Error('Position not found');
      }
      
      const position = positionResult.rows[0];
      
      if (position.status !== 'open') {
        throw new Error('Position already closed');
      }
      
      // Get current price and calculate final PnL
      const currentPrice = this.getCurrentPrice(position.asset);
      const pnl = this.calculatePnL(position, currentPrice);
      
      // Update position
      const updateResult = await client.query(
        `UPDATE trades 
         SET status = 'closed',
             exit_price = $1,
             pnl = $2,
             closed_at = $3
         WHERE id = $4
         RETURNING *`,
        [currentPrice, pnl.amount, new Date(), positionId]
      );
      
      // Update user stats
      if (pnl.amount > 0) {
        await client.query(
          `UPDATE user_stats 
           SET wins_count = wins_count + 1
           WHERE user_id = $1`,
          [userId]
        );
      }
      
      await client.query('COMMIT');
      
      const closedPosition = this.mapToMockPosition(updateResult.rows[0]);
      
      // Award XP for closing
      await this.awardMockXP(userId, 'mock_trade_closed', {
        pnl: pnl.amount,
        duration: closedPosition.closedAt!.getTime() - closedPosition.openedAt.getTime(),
        reason,
      });
      
      // Send notifications
      this.notifyPositionClosed(userId, closedPosition, reason);
      
      // Send educational content based on result
      await this.sendEducationalContent(userId, closedPosition, pnl);
      
      return closedPosition;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to close mock position:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  private scheduleAutoClose(positionId: number, userId: number) {
    setTimeout(async () => {
      try {
        await this.closeMockPosition(positionId, userId, 'auto_timeout');
      } catch (error) {
        // Position might already be closed
        logger.debug('Auto-close failed:', error);
      }
    }, this.AUTO_CLOSE_TIME);
  }
  
  private async awardMockXP(userId: number, action: string, metadata: any) {
    const baseXP = {
      mock_trade_opened: 15,
      mock_trade_closed: 10,
      mock_profit: 20,
      mock_streak: 30,
    };
    
    const xpAmount = Math.floor((baseXP[action] || 10) * this.MOCK_XP_MULTIPLIER);
    
    await XPService.getInstance().awardXP(userId, action, metadata);
  }
  
  private async checkAndSendTutorialHints(userId: number, position: MockPosition) {
    const pool = getPool();
    
    // Check if user is new (less than 5 trades)
    const tradeCount = await pool.query(
      'SELECT COUNT(*) as count FROM trades WHERE user_id = $1',
      [userId]
    );
    
    if (parseInt(tradeCount.rows[0].count) < 5) {
      const hints = [
        {
          condition: position.direction === 'long',
          message: '📈 You went LONG on ' + position.asset + '! You profit when the price goes UP.',
        },
        {
          condition: position.direction === 'short',
          message: '📉 You went SHORT on ' + position.asset + '! You profit when the price goes DOWN.',
        },
        {
          condition: true,
          message: '💡 Tip: Swipe left on your position to close it and take your profit/loss!',
        },
      ];
      
      const relevantHint = hints.find(h => h.condition);
      
      if (relevantHint) {
        WebSocketService.getInstance().sendToUser(userId, {
          type: 'tutorial_hint',
          data: {
            message: relevantHint.message,
            positionId: position.id,
          }
        });
      }
    }
  }
  
  private async sendEducationalContent(userId: number, position: MockPosition, pnl: any) {
    const educationalMessages = {
      profit: [
        '🎉 Great job! You made a profit. In real trading, always remember to manage your risk.',
        '💰 Nice win! Consider setting stop-losses to protect your profits in real trades.',
        '📊 Well done! Try to understand why this trade worked - was it luck or good analysis?',
      ],
      loss: [
        '📉 Losses are part of trading. The key is to keep them small and learn from them.',
        '🛡️ In real trading, always use stop-losses to limit your downside risk.',
        '📚 Every loss is a lesson. What could you have done differently?',
      ],
      quickClose: [
        '⚡ Quick trades can be risky. In real markets, fees can eat into profits on short trades.',
        '⏱️ Patience is key in trading. Sometimes the best action is no action.',
      ],
    };
    
    let messageType: string;
    const tradeDuration = position.closedAt!.getTime() - position.openedAt.getTime();
    
    if (tradeDuration < 60000) { // Less than 1 minute
      messageType = 'quickClose';
    } else if (pnl.amount > 0) {
      messageType = 'profit';
    } else {
      messageType = 'loss';
    }
    
    const messages = educationalMessages[messageType];
    const message = messages[Math.floor(Math.random() * messages.length)];
    
    WebSocketService.getInstance().sendToUser(userId, {
      type: 'educational_tip',
      data: {
        message,
        category: messageType,
        positionId: position.id,
      }
    });
  }
  
  private notifyTradeExecution(userId: number, position: MockPosition) {
    WebSocketService.getInstance().sendToUser(userId, {
      type: 'mock_trade_executed',
      data: {
        position,
        message: `Mock ${position.direction.toUpperCase()} position opened on ${position.asset}`,
      }
    });
  }
  
  private notifyPositionClosed(userId: number, position: MockPosition, reason: string) {
    const messages = {
      manual: 'Position closed manually',
      auto_timeout: 'Position auto-closed after 5 minutes',
      auto_limit: 'Position auto-closed at ±20% limit',
    };
    
    WebSocketService.getInstance().sendToUser(userId, {
      type: 'mock_position_closed',
      data: {
        position,
        reason,
        message: messages[reason],
        pnl: position.pnl,
        pnlPercentage: position.pnlPercentage,
      }
    });
  }
  
  private broadcastPositionUpdates(positions: MockPosition[]) {
    // Group by user
    const positionsByUser = new Map<number, MockPosition[]>();
    
    positions.forEach(position => {
      if (!positionsByUser.has(position.userId)) {
        positionsByUser.set(position.userId, []);
      }
      positionsByUser.get(position.userId)!.push(position);
    });
    
    // Send updates to each user
    positionsByUser.forEach((userPositions, userId) => {
      WebSocketService.getInstance().sendToUser(userId, {
        type: 'mock_positions_update',
        data: {
          positions: userPositions,
          timestamp: Date.now(),
        }
      });
    });
  }
  
  async getUserMockPositions(userId: number, status?: 'open' | 'closed'): Promise<MockPosition[]> {
    const pool = getPool();
    
    let query = 'SELECT * FROM trades WHERE user_id = $1 AND is_mock = true';
    const params: any[] = [userId];
    
    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }
    
    query += ' ORDER BY opened_at DESC LIMIT 50';
    
    const result = await pool.query(query, params);
    
    return result.rows.map(row => this.mapToMockPosition(row));
  }
  
  async getMockTradingStats(userId: number): Promise<any> {
    const pool = getPool();
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_trades,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_positions,
        COUNT(CASE WHEN pnl > 0 THEN 1 END) as winning_trades,
        COUNT(CASE WHEN pnl < 0 THEN 1 END) as losing_trades,
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(MAX(pnl), 0) as best_trade,
        COALESCE(MIN(pnl), 0) as worst_trade,
        COALESCE(AVG(CASE WHEN status = 'closed' 
          THEN EXTRACT(EPOCH FROM (closed_at - opened_at)) 
        END), 0) as avg_trade_duration
      FROM trades
      WHERE user_id = $1 AND is_mock = true
    `, [userId]);
    
    const row = stats.rows[0];
    const winRate = row.total_trades > 0 
      ? (row.winning_trades / row.total_trades) * 100 
      : 0;
    
    return {
      totalTrades: parseInt(row.total_trades),
      openPositions: parseInt(row.open_positions),
      winningTrades: parseInt(row.winning_trades),
      losingTrades: parseInt(row.losing_trades),
      winRate: winRate.toFixed(1),
      totalPnL: parseFloat(row.total_pnl),
      bestTrade: parseFloat(row.best_trade),
      worstTrade: parseFloat(row.worst_trade),
      avgTradeDuration: Math.floor(row.avg_trade_duration),
    };
  }
  
  private mapToMockPosition(row: any): MockPosition {
    const currentPrice = row.current_price || row.exit_price || row.entry_price;
    const pnl = row.pnl || 0;
    const pnlPercentage = row.entry_price > 0 
      ? (pnl / (row.size / row.entry_price)) * 100 
      : 0;
    
    return {
      id: row.id,
      userId: row.user_id,
      asset: row.asset,
      direction: row.direction,
      size: parseFloat(row.size),
      entryPrice: parseFloat(row.entry_price),
      currentPrice: parseFloat(currentPrice),
      pnl: parseFloat(pnl),
      pnlPercentage,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    };
  }
  
  shutdown() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
    }
  }
}