import { getPool } from '../database/connection';
import { getRedis } from './redis';
import { logger } from '../utils/logger';
import { WebSocketService } from './WebSocketService';
import { StarknetService } from './StarknetService';

interface XPAction {
  type: string;
  baseAmount: number;
  cooldown?: number; // in seconds
  maxDaily?: number;
}

export class XPService {
  private static instance: XPService;
  private xpActions!: Map<string, XPAction>;
  private levelThresholds!: number[];
  
  public constructor() {
    this.initializeXPActions();
    this.initializeLevelThresholds();
  }
  
  static getInstance(): XPService {
    if (!this.instance) {
      this.instance = new XPService();
    }
    return this.instance;
  }
  
  private initializeXPActions() {
    this.xpActions = new Map([
      ['first_trade', { type: 'first_trade', baseAmount: 100 }],
      ['trade_executed', { type: 'trade_executed', baseAmount: 20, cooldown: 60 }],
      ['profitable_trade', { type: 'profitable_trade', baseAmount: 50 }],
      ['loss_trade', { type: 'loss_trade', baseAmount: 10 }],
      ['mock_trade', { type: 'mock_trade', baseAmount: 15, maxDaily: 10 }],
      ['daily_login', { type: 'daily_login', baseAmount: 5, cooldown: 86400 }],
      ['streak_7', { type: 'streak_7', baseAmount: 100 }],
      ['streak_30', { type: 'streak_30', baseAmount: 500 }],
      ['referral_joined', { type: 'referral_joined', baseAmount: 200 }],
      ['achievement_shared', { type: 'achievement_shared', baseAmount: 25, cooldown: 3600 }],
    ]);
  }
  
  private initializeLevelThresholds() {
    this.levelThresholds = [
      0,      // Level 1
      100,    // Level 2
      300,    // Level 3
      600,    // Level 4
      1000,   // Level 5
      1600,   // Level 6
      2500,   // Level 7
      4000,   // Level 8
      6000,   // Level 9
      10000   // Level 10
    ];
  }
  
  async awardXP(userId: number, actionType: string, metadata?: any): Promise<boolean> {
    const action = this.xpActions.get(actionType);
    if (!action) {
      logger.warn(`Unknown XP action type: ${actionType}`);
      return false;
    }
    
    // Check cooldown
    if (action.cooldown) {
      const isOnCooldown = await this.checkCooldown(userId, actionType, action.cooldown);
      if (isOnCooldown) {
        logger.info(`User ${userId} on cooldown for action ${actionType}`);
        return false;
      }
    }
    
    // Check daily limit
    if (action.maxDaily) {
      const dailyCount = await this.getDailyActionCount(userId, actionType);
      if (dailyCount >= action.maxDaily) {
        logger.info(`User ${userId} reached daily limit for ${actionType}`);
        return false;
      }
    }
    
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Calculate XP amount (with potential multipliers)
      const xpAmount = await this.calculateXPAmount(userId, action, metadata);
      
      // Log XP award
      await client.query(
        `INSERT INTO xp_logs (user_id, action_type, xp_amount, metadata)
         VALUES ($1, $2, $3, $4)`,
        [userId, actionType, xpAmount, JSON.stringify(metadata)]
      );
      
      // Update user stats
      const statsResult = await client.query(
        `UPDATE user_stats 
         SET xp_total = xp_total + $1
         WHERE user_id = $2
         RETURNING xp_total, level`,
        [xpAmount, userId]
      );
      
      const { xp_total, level } = statsResult.rows[0];
      
      // Check for level up
      const newLevel = this.calculateLevel(xp_total);
      let leveledUp = false;
      
      if (newLevel > level) {
        await client.query(
          `UPDATE user_stats SET level = $1 WHERE user_id = $2`,
          [newLevel, userId]
        );
        leveledUp = true;
        
        // Award level up achievements
        await this.checkLevelAchievements(userId, newLevel);
      }
      
      await client.query('COMMIT');
      
      // Update Redis leaderboard
      await this.updateLeaderboard(userId, xp_total);
      
      // Store XP action intent for blockchain sync
      await this.queueXPIntent(userId, actionType, xpAmount, metadata);
      
      // Notify user via WebSocket
      WebSocketService.getInstance().sendToUser(userId, {
        type: 'xp_gained',
        data: {
          actionType,
          xpAmount,
          totalXP: xp_total,
          level: newLevel,
          leveledUp
        }
      });
      
      // Set cooldown if applicable
      if (action.cooldown) {
        await this.setCooldown(userId, actionType, action.cooldown);
      }
      
      return true;
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to award XP:', error);
      return false;
    } finally {
      client.release();
    }
  }
  
  private async calculateXPAmount(userId: number, action: XPAction, metadata?: any): Promise<number> {
    let amount = action.baseAmount;
    
    // Apply streak multiplier
    const streak = await this.getUserStreak(userId);
    if (streak >= 7) {
      amount *= 1.2;
    } else if (streak >= 3) {
      amount *= 1.1;
    }
    
    // Apply special event multipliers
    const eventMultiplier = await this.getEventMultiplier();
    amount *= eventMultiplier;
    
    return Math.floor(amount);
  }
  
  private calculateLevel(totalXP: number): number {
    for (let i = this.levelThresholds.length - 1; i >= 0; i--) {
      if (totalXP >= this.levelThresholds[i]) {
        return i + 1;
      }
    }
    return 1;
  }
  
  private async checkCooldown(userId: number, actionType: string, cooldownSeconds: number): Promise<boolean> {
    const redis = getRedis();
    const key = `cooldown:${userId}:${actionType}`;
    const exists = await redis.exists(key);
    return exists === 1;
  }
  
  private async setCooldown(userId: number, actionType: string, cooldownSeconds: number): Promise<void> {
    const redis = getRedis();
    const key = `cooldown:${userId}:${actionType}`;
    await redis.setex(key, cooldownSeconds, '1');
  }
  
  private async getDailyActionCount(userId: number, actionType: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM xp_logs
       WHERE user_id = $1 
         AND action_type = $2
         AND created_at >= CURRENT_DATE`,
      [userId, actionType]
    );
    
    return parseInt(result.rows[0].count);
  }
  
  private async getUserStreak(userId: number): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT current_streak FROM user_stats WHERE user_id = $1',
      [userId]
    );
    
    return result.rows[0]?.current_streak || 0;
  }
  
  private async getEventMultiplier(): Promise<number> {
    // Check for special events (weekends, holidays, etc.)
    const dayOfWeek = new Date().getDay();
    
    // Weekend bonus
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 1.5;
    }
    
    // Future: Check for special events from config
    return 1.0;
  }
  
  private async updateLeaderboard(userId: number, totalXP: number): Promise<void> {
    const redis = getRedis();
    
    // Update global leaderboard
    await redis.zadd('leaderboard:global', totalXP, userId.toString());
    
    // Update weekly leaderboard
    const weekKey = this.getCurrentWeekKey();
    await redis.zadd(`leaderboard:weekly:${weekKey}`, totalXP, userId.toString());
    
    // Update monthly leaderboard
    const monthKey = this.getCurrentMonthKey();
    await redis.zadd(`leaderboard:monthly:${monthKey}`, totalXP, userId.toString());
  }
  
  private getCurrentWeekKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const week = Math.ceil((now.getTime() - new Date(year, 0, 1).getTime()) / 604800000);
    return `${year}-W${week}`;
  }
  
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  
  private async queueXPIntent(userId: number, actionType: string, amount: number, metadata?: any): Promise<void> {
    const redis = getRedis();
    
    // Queue XP intent for blockchain sync
    const intent = {
      userId,
      actionType,
      amount,
      metadata,
      timestamp: Date.now()
    };
    
    await redis.lpush('xp_intents', JSON.stringify(intent));
    
    // Process batch when queue reaches threshold
    const queueLength = await redis.llen('xp_intents');
    if (queueLength >= 100) {
      this.processPendingXPIntents();
    }
  }
  
  private async processPendingXPIntents(): Promise<void> {
    try {
      const redis = getRedis();
      const intents = [];
      
      // Get up to 100 intents
      for (let i = 0; i < 100; i++) {
        const intentStr = await redis.rpop('xp_intents');
        if (!intentStr) break;
        intents.push(JSON.parse(intentStr));
      }
      
      if (intents.length === 0) return;
      
      // Batch process on blockchain
      await StarknetService.getInstance().batchUpdateXP(intents);
      
    } catch (error) {
      logger.error('Failed to process XP intents:', error);
    }
  }
  
  private async checkLevelAchievements(userId: number, level: number): Promise<void> {
    const achievements = [];
    
    if (level === 5) {
      achievements.push('basic_trader');
    } else if (level === 10) {
      achievements.push('castle_lord');
    }
    
    for (const achievementType of achievements) {
      await this.awardAchievement(userId, achievementType);
    }
  }
  
  private async awardAchievement(userId: number, achievementType: string): Promise<void> {
    const pool = getPool();
    
    try {
      await pool.query(
        `INSERT INTO achievements (user_id, achievement_type, metadata)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, achievement_type) DO NOTHING`,
        [userId, achievementType, JSON.stringify({ timestamp: Date.now() })]
      );
      
      // Mint NFT for achievement
      await StarknetService.getInstance().mintAchievementNFT(userId, achievementType);
      
      // Notify user
      WebSocketService.getInstance().sendToUser(userId, {
        type: 'achievement_unlocked',
        data: {
          achievementType,
          title: this.getAchievementTitle(achievementType)
        }
      });
      
    } catch (error) {
      logger.error('Failed to award achievement:', error);
    }
  }
  
  private getAchievementTitle(type: string): string {
    const titles: Record<string, string> = {
      'basic_trader': 'Basic Trader',
      'castle_lord': 'Castle Lord',
      'profit_prophet': 'Profit Prophet',
      'degen_lord': 'Degen Lord'
    };
    
    return titles[type] || 'Unknown Achievement';
  }
  
  async getUserStats(userId: number): Promise<any> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM user_stats WHERE user_id = $1',
      [userId]
    );
    
    return result.rows[0];
  }
  
  async getLeaderboard(type: 'global' | 'weekly' | 'monthly', limit: number = 100): Promise<any[]> {
    const redis = getRedis();
    let key = 'leaderboard:global';
    
    if (type === 'weekly') {
      key = `leaderboard:weekly:${this.getCurrentWeekKey()}`;
    } else if (type === 'monthly') {
      key = `leaderboard:monthly:${this.getCurrentMonthKey()}`;
    }
    
    // Get top users from Redis
    const topUsers = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    
    // Format leaderboard data
    const leaderboard = [];
    for (let i = 0; i < topUsers.length; i += 2) {
      const userId = parseInt(topUsers[i]);
      const xp = parseInt(topUsers[i + 1]);
      
      // Get user details
      const pool = getPool();
      const userResult = await pool.query(
        'SELECT username, wallet_address FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length > 0) {
        leaderboard.push({
          rank: Math.floor(i / 2) + 1,
          userId,
          username: userResult.rows[0].username,
          walletAddress: userResult.rows[0].wallet_address,
          xp
        });
      }
    }
    
    return leaderboard;
  }
}