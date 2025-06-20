import { getPool } from '../database/connection';
import { getRedis } from './redis';
import { logger } from '../utils/logger';
import { WebSocketService } from './WebSocketService';
import { StarknetService } from './StarknetService';

interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  walletAddress: string;
  xp: number;
  level: number;
  avatar?: string;
  badges: string[];
  change?: number; // Position change since last update
}

interface LeaderboardUpdate {
  userId: number;
  oldRank: number | null;
  newRank: number;
  xp: number;
}

export class LeaderboardService {
  private static instance: LeaderboardService;
  private redis = getRedis();
  private updateQueue: Map<string, Set<number>> = new Map();
  private updateInterval: NodeJS.Timer;
  
  // Leaderboard configurations
  private readonly GLOBAL_SIZE = 100;
  private readonly CACHE_TTL = 60; // 1 minute
  private readonly UPDATE_BATCH_SIZE = 50;
  private readonly RANK_CHANGE_THRESHOLD = 10; // Notify if rank changes by 10+
  
  private constructor() {
    this.startPeriodicUpdates();
  }
  
  static getInstance(): LeaderboardService {
    if (!this.instance) {
      this.instance = new LeaderboardService();
    }
    return this.instance;
  }
  
  private startPeriodicUpdates() {
    // Process queued updates every 5 seconds
    this.updateInterval = setInterval(() => {
      this.processQueuedUpdates();
    }, 5000);
  }
  
  async updateUserScore(userId: number, newXP: number): Promise<void> {
    try {
      // Update all leaderboard types
      await this.updateLeaderboard('global', userId, newXP);
      await this.updateLeaderboard('weekly', userId, newXP);
      await this.updateLeaderboard('monthly', userId, newXP);
      
      // Queue for batch notification
      this.queueUpdate('global', userId);
      
    } catch (error) {
      logger.error('Failed to update leaderboard score:', error);
    }
  }
  
  private async updateLeaderboard(
    type: 'global' | 'weekly' | 'monthly',
    userId: number,
    score: number
  ): Promise<void> {
    const key = this.getLeaderboardKey(type);
    
    // Get old rank
    const oldRank = await this.redis.zrevrank(key, userId.toString());
    
    // Update score
    await this.redis.zadd(key, score, userId.toString());
    
    // Get new rank
    const newRank = await this.redis.zrevrank(key, userId.toString());
    
    // Check for significant rank change
    if (oldRank !== null && newRank !== null) {
      const rankChange = oldRank - newRank;
      
      if (Math.abs(rankChange) >= this.RANK_CHANGE_THRESHOLD || newRank < 10) {
        // Notify user of significant rank change
        this.notifyRankChange(userId, oldRank + 1, newRank + 1, type);
      }
    }
    
    // Invalidate cache
    await this.redis.del(`${key}:cache`);
  }
  
  private queueUpdate(type: string, userId: number) {
    if (!this.updateQueue.has(type)) {
      this.updateQueue.set(type, new Set());
    }
    this.updateQueue.get(type)!.add(userId);
  }
  
  private async processQueuedUpdates() {
    for (const [type, userIds] of this.updateQueue.entries()) {
      if (userIds.size === 0) continue;
      
      // Process in batches
      const updates: LeaderboardUpdate[] = [];
      const userIdArray = Array.from(userIds);
      
      for (let i = 0; i < userIdArray.length; i += this.UPDATE_BATCH_SIZE) {
        const batch = userIdArray.slice(i, i + this.UPDATE_BATCH_SIZE);
        const batchUpdates = await this.getBatchUpdates(type, batch);
        updates.push(...batchUpdates);
      }
      
      // Send updates via WebSocket
      if (updates.length > 0) {
        WebSocketService.getInstance().publishLeaderboardUpdate(updates);
      }
      
      // Clear processed users
      userIds.clear();
    }
  }
  
  private async getBatchUpdates(
    type: string,
    userIds: number[]
  ): Promise<LeaderboardUpdate[]> {
    const key = this.getLeaderboardKey(type as any);
    const updates: LeaderboardUpdate[] = [];
    
    for (const userId of userIds) {
      const rank = await this.redis.zrevrank(key, userId.toString());
      const score = await this.redis.zscore(key, userId.toString());
      
      if (rank !== null && score !== null) {
        updates.push({
          userId,
          oldRank: null, // Would need to track this separately
          newRank: rank + 1,
          xp: parseInt(score),
        });
      }
    }
    
    return updates;
  }
  
  async getLeaderboard(
    type: 'global' | 'weekly' | 'monthly',
    limit: number = 100,
    offset: number = 0
  ): Promise<LeaderboardEntry[]> {
    const key = this.getLeaderboardKey(type);
    const cacheKey = `${key}:cache:${limit}:${offset}`;
    
    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Get top users from Redis
    const topUsers = await this.redis.zrevrange(
      key,
      offset,
      offset + limit - 1,
      'WITHSCORES'
    );
    
    if (topUsers.length === 0) {
      return [];
    }
    
    // Build leaderboard with user details
    const leaderboard = await this.buildLeaderboardEntries(topUsers, offset);
    
    // Cache result
    await this.redis.setex(
      cacheKey,
      this.CACHE_TTL,
      JSON.stringify(leaderboard)
    );
    
    return leaderboard;
  }
  
  private async buildLeaderboardEntries(
    redisData: string[],
    offset: number
  ): Promise<LeaderboardEntry[]> {
    const pool = getPool();
    const entries: LeaderboardEntry[] = [];
    const userIds: number[] = [];
    const scores: Map<number, number> = new Map();
    
    // Parse Redis data
    for (let i = 0; i < redisData.length; i += 2) {
      const userId = parseInt(redisData[i]);
      const score = parseInt(redisData[i + 1]);
      userIds.push(userId);
      scores.set(userId, score);
    }
    
    // Batch fetch user details
    const userResult = await pool.query(
      `SELECT u.id, u.username, u.wallet_address, us.level
       FROM users u
       JOIN user_stats us ON u.id = us.user_id
       WHERE u.id = ANY($1)`,
      [userIds]
    );
    
    // Batch fetch achievements
    const achievementResult = await pool.query(
      `SELECT user_id, achievement_type
       FROM achievements
       WHERE user_id = ANY($1)`,
      [userIds]
    );
    
    // Map achievements to users
    const userAchievements = new Map<number, string[]>();
    achievementResult.rows.forEach(row => {
      if (!userAchievements.has(row.user_id)) {
        userAchievements.set(row.user_id, []);
      }
      userAchievements.get(row.user_id)!.push(row.achievement_type);
    });
    
    // Build leaderboard entries
    let rank = offset + 1;
    for (const userId of userIds) {
      const user = userResult.rows.find(r => r.id === userId);
      if (!user) continue;
      
      entries.push({
        rank: rank++,
        userId: user.id,
        username: user.username || `User${user.id}`,
        walletAddress: user.wallet_address,
        xp: scores.get(userId)!,
        level: user.level,
        badges: this.mapAchievementsToBadges(userAchievements.get(userId) || []),
        change: 0, // Would need historical data for this
      });
    }
    
    return entries;
  }
  
  private mapAchievementsToBadges(achievements: string[]): string[] {
    const badgeMap: Record<string, string> = {
      'first_trade': '🎯',
      'profit_prophet': '💰',
      'degen_lord': '👑',
      'streak_master': '🔥',
      'early_adopter': '🌟',
      'whale': '🐋',
      'speed_demon': '⚡',
    };
    
    return achievements
      .map(a => badgeMap[a])
      .filter(Boolean);
  }
  
  async getUserRank(userId: number, type: 'global' | 'weekly' | 'monthly'): Promise<number | null> {
    const key = this.getLeaderboardKey(type);
    const rank = await this.redis.zrevrank(key, userId.toString());
    
    return rank !== null ? rank + 1 : null;
  }
  
  async getUserLeaderboardStats(userId: number): Promise<any> {
    const [globalRank, weeklyRank, monthlyRank] = await Promise.all([
      this.getUserRank(userId, 'global'),
      this.getUserRank(userId, 'weekly'),
      this.getUserRank(userId, 'monthly'),
    ]);
    
    // Get percentile rankings
    const totalUsers = await this.redis.zcard(this.getLeaderboardKey('global'));
    const percentile = globalRank 
      ? Math.round((1 - (globalRank / totalUsers)) * 100)
      : 0;
    
    return {
      global: {
        rank: globalRank,
        percentile,
      },
      weekly: {
        rank: weeklyRank,
      },
      monthly: {
        rank: monthlyRank,
      },
    };
  }
  
  async getAroundUser(
    userId: number,
    type: 'global' | 'weekly' | 'monthly',
    range: number = 5
  ): Promise<LeaderboardEntry[]> {
    const key = this.getLeaderboardKey(type);
    const userRank = await this.redis.zrevrank(key, userId.toString());
    
    if (userRank === null) {
      return [];
    }
    
    // Get users around the current user
    const start = Math.max(0, userRank - range);
    const end = userRank + range;
    
    const nearbyUsers = await this.redis.zrevrange(
      key,
      start,
      end,
      'WITHSCORES'
    );
    
    return this.buildLeaderboardEntries(nearbyUsers, start);
  }
  
  private getLeaderboardKey(type: 'global' | 'weekly' | 'monthly'): string {
    switch (type) {
      case 'global':
        return 'leaderboard:global';
      case 'weekly':
        return `leaderboard:weekly:${this.getCurrentWeekKey()}`;
      case 'monthly':
        return `leaderboard:monthly:${this.getCurrentMonthKey()}`;
    }
  }
  
  private getCurrentWeekKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const week = this.getWeekNumber(now);
    return `${year}-W${week}`;
  }
  
  private getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }
  
  private async notifyRankChange(
    userId: number,
    oldRank: number,
    newRank: number,
    type: string
  ) {
    const change = oldRank - newRank;
    const message = change > 0
      ? `🚀 You climbed ${change} spots to rank #${newRank} on the ${type} leaderboard!`
      : `📉 You dropped ${Math.abs(change)} spots to rank #${newRank} on the ${type} leaderboard.`;
    
    WebSocketService.getInstance().sendToUser(userId, {
      type: 'rank_change',
      data: {
        type,
        oldRank,
        newRank,
        change,
        message,
      },
    });
  }
  
  async resetWeeklyLeaderboard(): Promise<void> {
    const currentWeek = this.getCurrentWeekKey();
    const previousWeek = this.getPreviousWeekKey();
    
    // Archive previous week's leaderboard
    const topUsers = await this.redis.zrevrange(
      `leaderboard:weekly:${previousWeek}`,
      0,
      99,
      'WITHSCORES'
    );
    
    if (topUsers.length > 0) {
      // Store snapshot in database
      const pool = getPool();
      await pool.query(
        `INSERT INTO leaderboard_snapshots (period_type, period_start, period_end, rankings)
         VALUES ($1, $2, $3, $4)`,
        [
          'weekly',
          this.getWeekStartDate(previousWeek),
          new Date(),
          JSON.stringify(topUsers),
        ]
      );
      
      // Award rewards to top players
      await this.awardWeeklyRewards(topUsers);
    }
    
    // Clear the old weekly leaderboard
    await this.redis.del(`leaderboard:weekly:${previousWeek}`);
  }
  
  private async awardWeeklyRewards(topUsers: string[]) {
    const rewards = [
      { rank: 1, xp: 1000, achievement: 'weekly_champion' },
      { rank: 2, xp: 500, achievement: 'weekly_runner_up' },
      { rank: 3, xp: 250, achievement: 'weekly_third' },
    ];
    
    for (let i = 0; i < Math.min(6, topUsers.length); i += 2) {
      const userId = parseInt(topUsers[i]);
      const rank = i / 2 + 1;
      
      const reward = rewards.find(r => r.rank === rank);
      if (reward) {
        // Award bonus XP
        await this.awardBonusXP(userId, reward.xp);
        
        // Award achievement
        await this.awardAchievement(userId, reward.achievement);
      }
    }
  }
  
  private async awardBonusXP(userId: number, amount: number) {
    // This would integrate with XPService
    const pool = getPool();
    await pool.query(
      `UPDATE user_stats SET xp_total = xp_total + $1 WHERE user_id = $2`,
      [amount, userId]
    );
  }
  
  private async awardAchievement(userId: number, achievementType: string) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO achievements (user_id, achievement_type)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, achievementType]
    );
  }
  
  private getPreviousWeekKey(): string {
    const now = new Date();
    now.setDate(now.getDate() - 7);
    const year = now.getFullYear();
    const week = this.getWeekNumber(now);
    return `${year}-W${week}`;
  }
  
  private getWeekStartDate(weekKey: string): Date {
    const [year, week] = weekKey.split('-W').map(Number);
    const date = new Date(year, 0, 1);
    const dayOfWeek = date.getDay();
    const daysToAdd = (week - 1) * 7 - dayOfWeek + 1;
    date.setDate(date.getDate() + daysToAdd);
    return date;
  }
  
  shutdown() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
}