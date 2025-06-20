import axios from 'axios';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { logger } from '../utils/logger';
import { getPool } from '../database/connection';
import { XPService } from './XPService';
import { WebSocketService } from './WebSocketService';

export interface TradeParams {
  userId: number;
  asset: string;
  direction: 'long' | 'short';
  size: number;
  isMock?: boolean;
}

export interface TradeResult {
  success: boolean;
  tradeId?: number;
  txHash?: string;
  error?: string;
}

export class TradingService {
  private static instance: TradingService;
  private tradeQueue: Queue;
  private tradeWorker: Worker;
  private extendedApiUrl: string;
  private extendedApiKey: string;
  private queueEvents: QueueEvents;
  
  private constructor() {
    this.extendedApiUrl = process.env.EXTENDED_API_URL || 'https://api.extended.com';
    this.extendedApiKey = process.env.EXTENDED_API_KEY || '';
    
    this.tradeQueue = new Queue('trades', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      }
    });
    
    this.queueEvents = new QueueEvents('trades', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      }
    });
    
    this.tradeWorker = new Worker('trades', async (job) => {
      const { tradeParams } = job.data;
      
      try {
        if (tradeParams.isMock) {
          return await this.executeMockTrade(tradeParams);
        } else {
          return await this.executeRealTrade(tradeParams);
        }
      } catch (error) {
        logger.error('Trade execution failed:', error);
        throw error;
      }
    });
  }
  
  static getInstance(): TradingService {
    if (!this.instance) {
      this.instance = new TradingService();
    }
    return this.instance;
  }
  
  async queueTrade(params: TradeParams): Promise<TradeResult> {
    try {
      const job = await this.tradeQueue.add('execute-trade', {
        tradeParams: params
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        }
      });
      
      // Wait for job completion
      const result = await job.waitUntilFinished(this.queueEvents);
      return result;
      
    } catch (error) {
      logger.error('Failed to queue trade:', error);
      return {
        success: false,
        error: 'Failed to process trade'
      };
    }
  }
  
  private async executeRealTrade(params: TradeParams): Promise<TradeResult> {
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get current price from Extended API
      const priceResponse = await axios.get(
        `${this.extendedApiUrl}/v1/price/${params.asset}`,
        {
          headers: { 'X-API-Key': this.extendedApiKey },
          timeout: 5000
        }
      );
      
      const currentPrice = priceResponse.data.price;
      
      // Execute trade via Extended API
      const tradeResponse = await axios.post(
        `${this.extendedApiUrl}/v1/trade`,
        {
          symbol: params.asset,
          side: params.direction,
          size: params.size,
          type: 'market'
        },
        {
          headers: { 'X-API-Key': this.extendedApiKey },
          timeout: 10000
        }
      );
      
      // Insert trade record
      const tradeResult = await client.query(
        `INSERT INTO trades (user_id, asset, direction, size, entry_price, status, is_mock, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [params.userId, params.asset, params.direction, params.size, 
         currentPrice, 'open', false, tradeResponse.data.txHash]
      );
      
      const tradeId = tradeResult.rows[0].id;
      
      // Update user stats
      await client.query(
        `UPDATE user_stats 
         SET trades_count = trades_count + 1,
             total_volume = total_volume + $1
         WHERE user_id = $2`,
        [params.size, params.userId]
      );
      
      await client.query('COMMIT');
      
      // Award XP for trading
      await XPService.getInstance().awardXP(params.userId, 'trade_executed', {
        tradeId,
        asset: params.asset,
        size: params.size
      });
      
      // Notify via WebSocket
      WebSocketService.getInstance().sendToUser(params.userId, {
        type: 'trade_executed',
        data: {
          tradeId,
          asset: params.asset,
          direction: params.direction,
          size: params.size,
          price: currentPrice
        }
      });
      
      return {
        success: true,
        tradeId,
        txHash: tradeResponse.data.txHash
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Real trade execution failed:', error);
      
      // Check if it's an API error we can handle gracefully
      if (axios.isAxiosError(error) && error.response?.status === 503) {
        throw new Error('Extended API temporarily unavailable');
      }
      
      return {
        success: false,
        error: 'Trade execution failed'
      };
    } finally {
      client.release();
    }
  }
  
  private async executeMockTrade(params: TradeParams): Promise<TradeResult> {
    const pool = getPool();
    
    try {
      // Simulate price (in production, still fetch real price)
      const mockPrice = this.getMockPrice(params.asset);
      
      // Insert mock trade
      const result = await pool.query(
        `INSERT INTO trades (user_id, asset, direction, size, entry_price, status, is_mock)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [params.userId, params.asset, params.direction, params.size, 
         mockPrice, 'open', true]
      );
      
      const tradeId = result.rows[0].id;
      
      // Award reduced XP for mock trades
      await XPService.getInstance().awardXP(params.userId, 'mock_trade', {
        tradeId,
        asset: params.asset
      });
      
      // Simulate trade closure after 30 seconds
      setTimeout(() => {
        this.closeMockTrade(tradeId, params.userId);
      }, 30000);
      
      return {
        success: true,
        tradeId
      };
      
    } catch (error) {
      logger.error('Mock trade execution failed:', error);
      return {
        success: false,
        error: 'Mock trade failed'
      };
    }
  }
  
  private async closeMockTrade(tradeId: number, userId: number) {
    const pool = getPool();
    
    try {
      // Get trade details
      const tradeResult = await pool.query(
        'SELECT * FROM trades WHERE id = $1',
        [tradeId]
      );
      
      const trade = tradeResult.rows[0];
      if (!trade || trade.status !== 'open') return;
      
      // Simulate PnL (random for demo, use price feeds in production)
      const priceChange = (Math.random() - 0.5) * 0.02; // ±2%
      const exitPrice = trade.entry_price * (1 + priceChange);
      const pnl = trade.direction === 'long' 
        ? (exitPrice - trade.entry_price) * trade.size / trade.entry_price
        : (trade.entry_price - exitPrice) * trade.size / trade.entry_price;
      
      // Update trade
      await pool.query(
        `UPDATE trades 
         SET exit_price = $1, pnl = $2, status = $3, closed_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [exitPrice, pnl, 'closed', tradeId]
      );
      
      // Update user stats
      if (pnl > 0) {
        await pool.query(
          `UPDATE user_stats 
           SET wins_count = wins_count + 1,
               total_pnl = total_pnl + $1
           WHERE user_id = $2`,
          [pnl, userId]
        );
        
        // Award XP for profit
        await XPService.getInstance().awardXP(userId, 'profitable_trade', {
          tradeId,
          pnl
        });
      }
      
      // Notify user
      WebSocketService.getInstance().sendToUser(userId, {
        type: 'trade_closed',
        data: {
          tradeId,
          pnl,
          exitPrice
        }
      });
      
    } catch (error) {
      logger.error('Failed to close mock trade:', error);
    }
  }
  
  private getMockPrice(asset: string): number {
    // Mock prices for demo
    const prices: Record<string, number> = {
      'BTC': 45000,
      'ETH': 2500,
      'SOL': 100,
      'DOGE': 0.15,
      'PEPE': 0.000001
    };
    
    return prices[asset] || 100;
  }
  
  async getActiveTrades(userId: number): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM trades 
       WHERE user_id = $1 AND status = 'open'
       ORDER BY opened_at DESC`,
      [userId]
    );
    
    return result.rows;
  }
  
  async getTradeHistory(userId: number, limit: number = 50): Promise<any[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM trades 
       WHERE user_id = $1
       ORDER BY opened_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows;
  }
}