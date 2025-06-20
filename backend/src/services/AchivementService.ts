import { getPool } from '../database/connection';
import { logger } from '../utils/logger';
import { WebSocketService } from './WebSocketService';
import { StarknetService } from './StarknetService';
import { NotificationService } from './NotificationService';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  xpReward: number;
  requirements: AchievementRequirement[];
  metadata?: any;
}

interface AchievementRequirement {
  type: 'trades' | 'profit' | 'streak' | 'level' | 'referrals' | 'volume';
  value: number;
  comparison: 'gte' | 'eq' | 'gt';
  timeframe?: 'daily' | 'weekly' | 'monthly' | 'all-time';
}

interface UserAchievement {
  userId: number;
  achievementId: string;
  unlockedAt: Date;
  progress: number;
  nftTokenId?: string;
}

export class AchievementService {
  private static instance: AchievementService;
  private achievements: Map<string, Achievement> = new Map();
  private progressTrackers: Map<string, ProgressTracker> = new Map();
  
  private constructor() {
    this.initializeAchievements();
    this.initializeProgressTrackers();
  }
  
  static getInstance(): AchievementService {
    if (!this.instance) {
      this.instance = new AchievementService();
    }
    return this.instance;
  }
  
  private initializeAchievements() {
    const achievementsList: Achievement[] = [
      // Trading Achievements
      {
        id: 'first_blood',
        name: 'First Blood',
        description: 'Execute your first trade',
        icon: '🎯',
        rarity: 'common',
        xpReward: 100,
        requirements: [
          { type: 'trades', value: 1, comparison: 'gte' }
        ]
      },
      {
        id: 'trader_10',
        name: 'Active Trader',
        description: 'Complete 10 trades',
        icon: '📈',
        rarity: 'common',
        xpReward: 200,
        requirements: [
          { type: 'trades', value: 10, comparison: 'gte' }
        ]
      },
      {
        id: 'trader_100',
        name: 'Trade Warrior',
        description: 'Complete 100 trades',
        icon: '⚔️',
        rarity: 'rare',
        xpReward: 500,
        requirements: [
          { type: 'trades', value: 100, comparison: 'gte' }
        ]
      },
      {
        id: 'trader_1000',
        name: 'Trade Master',
        description: 'Complete 1000 trades',
        icon: '🏆',
        rarity: 'epic',
        xpReward: 2000,
        requirements: [
          { type: 'trades', value: 1000, comparison: 'gte' }
        ]
      },
      
      // Profit Achievements
      {
        id: 'first_profit',
        name: 'In the Green',
        description: 'Close your first profitable trade',
        icon: '💚',
        rarity: 'common',
        xpReward: 150,
        requirements: [
          { type: 'profit', value: 1, comparison: 'gt' }
        ]
      },
      {
        id: 'profit_streak_5',
        name: 'Hot Hand',
        description: '5 profitable trades in a row',
        icon: '🔥',
        rarity: 'rare',
        xpReward: 300,
        requirements: [
          { type: 'streak', value: 5, comparison: 'gte' }
        ]
      },
      {
        id: 'profit_prophet',
        name: 'Profit Prophet',
        description: '10 profitable trades in a row',
        icon: '🔮',
        rarity: 'epic',
        xpReward: 1000,
        requirements: [
          { type: 'streak', value: 10, comparison: 'gte' }
        ]
      },
      
      // Volume Achievements
      {
        id: 'volume_10k',
        name: 'Big Spender',
        description: 'Trade $10,000 in volume',
        icon: '💰',
        rarity: 'common',
        xpReward: 250,
        requirements: [
          { type: 'volume', value: 10000, comparison: 'gte' }
        ]
      },
      {
        id: 'volume_100k',
        name: 'High Roller',
        description: 'Trade $100,000 in volume',
        icon: '🎰',
        rarity: 'rare',
        xpReward: 1000,
        requirements: [
          { type: 'volume', value: 100000, comparison: 'gte' }
        ]
      },
      {
        id: 'whale',
        name: 'Whale',
        description: 'Trade $1,000,000 in volume',
        icon: '🐋',
        rarity: 'legendary',
        xpReward: 5000,
        requirements: [
          { type: 'volume', value: 1000000, comparison: 'gte' }
        ]
      },
      
      // Level Achievements
      {
        id: 'level_5',
        name: 'Rising Star',
        description: 'Reach Level 5',
        icon: '⭐',
        rarity: 'common',
        xpReward: 200,
        requirements: [
          { type: 'level', value: 5, comparison: 'gte' }
        ]
      },
      {
        id: 'level_10',
        name: 'Castle Lord',
        description: 'Reach Level 10',
        icon: '👑',
        rarity: 'epic',
        xpReward: 1000,
        requirements: [
          { type: 'level', value: 10, comparison: 'gte' }
        ]
      },
      
      // Social Achievements
      {
        id: 'referrer_1',
        name: 'Bring a Friend',
        description: 'Refer 1 friend who completes a trade',
        icon: '🤝',
        rarity: 'common',
        xpReward: 200,
        requirements: [
          { type: 'referrals', value: 1, comparison: 'gte' }
        ]
      },
      {
        id: 'referrer_10',
        name: 'Community Builder',
        description: 'Refer 10 friends who complete trades',
        icon: '🏘️',
        rarity: 'rare',
        xpReward: 1000,
        requirements: [
          { type: 'referrals', value: 10, comparison: 'gte' }
        ]
      },
      
      // Special Event Achievements
      {
        id: 'early_adopter',
        name: 'Early Adopter',
        description: 'Join during the first month',
        icon: '🌟',
        rarity: 'rare',
        xpReward: 500,
        requirements: []
      },
      {
        id: 'weekend_warrior',
        name: 'Weekend Warrior',
        description: 'Trade every weekend for a month',
        icon: '🗓️',
        rarity: 'rare',
        xpReward: 400,
        requirements: []
      },
      {
        id: 'night_owl',
        name: 'Night Owl',
        description: 'Execute 10 trades between midnight and 6 AM',
        icon: '🦉',
        rarity: 'rare',
        xpReward: 300,
        requirements: []
      },
      {
        id: 'speed_demon',
        name: 'Speed Demon',
        description: 'Execute 10 trades in 10 minutes',
        icon: '⚡',
        rarity: 'epic',
        xpReward: 750,
        requirements: []
      },
    ];
    
    achievementsList.forEach(achievement => {
      this.achievements.set(achievement.id, achievement);
    });
  }
  
  private initializeProgressTrackers() {
    // Initialize trackers for different achievement types
    this.progressTrackers.set('trades', new TradeProgressTracker());
    this.progressTrackers.set('profit', new ProfitProgressTracker());
    this.progressTrackers.set('volume', new VolumeProgressTracker());
    this.progressTrackers.set('referrals', new ReferralProgressTracker());
    this.progressTrackers.set('special', new SpecialProgressTracker());
  }
  
  async checkAchievements(userId: number, event: AchievementEvent): Promise<void> {
    try {
      // Get user's current achievements
      const unlockedAchievements = await this.getUserAchievements(userId);
      const unlockedIds = new Set(unlockedAchievements.map(a => a.achievementId));
      
      // Check each achievement
      for (const [id, achievement] of this.achievements) {
        if (unlockedIds.has(id)) continue;
        
        const isUnlocked = await this.checkRequirements(userId, achievement, event);
        
        if (isUnlocked) {
          await this.unlockAchievement(userId, achievement);
        }
      }
      
    } catch (error) {
      logger.error('Failed to check achievements:', error);
    }
  }
  
  private async checkRequirements(
    userId: number,
    achievement: Achievement,
    event: AchievementEvent
  ): Promise<boolean> {
    // Special achievements have custom logic
    if (achievement.requirements.length === 0) {
      return this.checkSpecialAchievement(userId, achievement, event);
    }
    
    // Check all requirements
    for (const requirement of achievement.requirements) {
      const met = await this.checkRequirement(userId, requirement, event);
      if (!met) return false;
    }
    
    return true;
  }
  
  private async checkRequirement(
    userId: number,
    requirement: AchievementRequirement,
    event: AchievementEvent
  ): Promise<boolean> {
    const tracker = this.progressTrackers.get(requirement.type);
    if (!tracker) return false;
    
    const value = await tracker.getValue(userId, requirement.timeframe);
    
    switch (requirement.comparison) {
      case 'gte':
        return value >= requirement.value;
      case 'gt':
        return value > requirement.value;
      case 'eq':
        return value === requirement.value;
      default:
        return false;
    }
  }
  
  private async checkSpecialAchievement(
    userId: number,
    achievement: Achievement,
    event: AchievementEvent
  ): Promise<boolean> {
    const specialTracker = this.progressTrackers.get('special') as SpecialProgressTracker;
    return specialTracker.checkSpecial(userId, achievement.id, event);
  }
  
  private async unlockAchievement(userId: number, achievement: Achievement): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Record achievement
      await client.query(
        `INSERT INTO achievements (user_id, achievement_type, metadata)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, achievement_type) DO NOTHING`,
        [userId, achievement.id, JSON.stringify({ 
          unlockedAt: new Date(),
          name: achievement.name
        })]
      );
      
      // Award XP
      await client.query(
        `UPDATE user_stats 
         SET xp_total = xp_total + $1
         WHERE user_id = $2`,
        [achievement.xpReward, userId]
      );
      
      await client.query('COMMIT');
      
      // Mint NFT for rare achievements
      if (achievement.rarity === 'epic' || achievement.rarity === 'legendary') {
        this.mintAchievementNFT(userId, achievement);
      }
      
      // Send notifications
      this.notifyAchievementUnlock(userId, achievement);
      
      // Log analytics
      this.logAchievementUnlock(userId, achievement);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to unlock achievement:', error);
    } finally {
      client.release();
    }
  }
  
  private async mintAchievementNFT(userId: number, achievement: Achievement) {
    try {
      const tokenId = await StarknetService.getInstance().mintAchievementNFT(
        userId,
        achievement.id
      );
      
      // Update database with token ID
      const pool = getPool();
      await pool.query(
        `UPDATE achievements 
         SET nft_token_id = $1
         WHERE user_id = $2 AND achievement_type = $3`,
        [tokenId, userId, achievement.id]
      );
      
    } catch (error) {
      logger.error('Failed to mint achievement NFT:', error);
    }
  }
  
  private notifyAchievementUnlock(userId: number, achievement: Achievement) {
    // WebSocket notification
    WebSocketService.getInstance().sendToUser(userId, {
      type: 'achievement_unlocked',
      data: {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        rarity: achievement.rarity,
        xpReward: achievement.xpReward,
      }
    });
    
    // Push notification
    NotificationService.getInstance().sendPushNotification(userId, {
      title: '🎉 Achievement Unlocked!',
      body: `You've earned "${achievement.name}"! +${achievement.xpReward} XP`,
      data: {
        type: 'achievement',
        achievementId: achievement.id,
      }
    });
  }
  
  private logAchievementUnlock(userId: number, achievement: Achievement) {
    logger.info('Achievement unlocked', {
      userId,
      achievementId: achievement.id,
      achievementName: achievement.name,
      rarity: achievement.rarity,
      xpReward: achievement.xpReward,
    });
  }
  
  async getUserAchievements(userId: number): Promise<UserAchievement[]> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT achievement_type, unlocked_at, nft_token_id, metadata
       FROM achievements
       WHERE user_id = $1
       ORDER BY unlocked_at DESC`,
      [userId]
    );
    
    return result.rows.map(row => ({
      userId,
      achievementId: row.achievement_type,
      unlockedAt: row.unlocked_at,
      progress: 100,
      nftTokenId: row.nft_token_id,
      ...row.metadata,
    }));
  }
  
  async getAchievementProgress(userId: number): Promise<Map<string, number>> {
    const progress = new Map<string, number>();
    const unlocked = await this.getUserAchievements(userId);
    const unlockedIds = new Set(unlocked.map(a => a.achievementId));
    
    for (const [id, achievement] of this.achievements) {
      if (unlockedIds.has(id)) {
        progress.set(id, 100);
      } else {
        const percent = await this.calculateProgress(userId, achievement);
        progress.set(id, percent);
      }
    }
    
    return progress;
  }
  
  private async calculateProgress(userId: number, achievement: Achievement): Promise<number> {
    if (achievement.requirements.length === 0) return 0;
    
    let totalProgress = 0;
    
    for (const requirement of achievement.requirements) {
      const tracker = this.progressTrackers.get(requirement.type);
      if (!tracker) continue;
      
      const current = await tracker.getValue(userId, requirement.timeframe);
      const progress = Math.min((current / requirement.value) * 100, 100);
      totalProgress += progress;
    }
    
    return Math.floor(totalProgress / achievement.requirements.length);
  }
  
  async getAchievementStats(): Promise<any> {
    const pool = getPool();
    
    const stats = await pool.query(`
      SELECT 
        achievement_type,
        COUNT(*) as unlock_count,
        MIN(unlocked_at) as first_unlock,
        MAX(unlocked_at) as last_unlock
      FROM achievements
      GROUP BY achievement_type
    `);
    
    const totalUsers = await pool.query('SELECT COUNT(DISTINCT id) as count FROM users');
    
    return {
      totalAchievements: this.achievements.size,
      unlockStats: stats.rows.map(row => ({
        id: row.achievement_type,
        name: this.achievements.get(row.achievement_type)?.name,
        unlockCount: parseInt(row.unlock_count),
        unlockRate: (parseInt(row.unlock_count) / parseInt(totalUsers.rows[0].count)) * 100,
        firstUnlock: row.first_unlock,
        lastUnlock: row.last_unlock,
      })),
    };
  }
}

// Progress Trackers
interface ProgressTracker {
  getValue(userId: number, timeframe?: string): Promise<number>;
}

class TradeProgressTracker implements ProgressTracker {
  async getValue(userId: number, timeframe?: string): Promise<number> {
    const pool = getPool();
    let query = 'SELECT COUNT(*) as count FROM trades WHERE user_id = $1';
    const params: any[] = [userId];
    
    if (timeframe === 'daily') {
      query += ' AND opened_at >= CURRENT_DATE';
    } else if (timeframe === 'weekly') {
      query += ' AND opened_at >= CURRENT_DATE - INTERVAL \'7 days\'';
    } else if (timeframe === 'monthly') {
      query += ' AND opened_at >= CURRENT_DATE - INTERVAL \'30 days\'';
    }
    
    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count);
  }
}

class ProfitProgressTracker implements ProgressTracker {
  async getValue(userId: number, timeframe?: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT current_streak FROM user_stats WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.current_streak || 0;
  }
}

class VolumeProgressTracker implements ProgressTracker {
  async getValue(userId: number, timeframe?: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT total_volume FROM user_stats WHERE user_id = $1',
      [userId]
    );
    return parseFloat(result.rows[0]?.total_volume || '0');
  }
}

class ReferralProgressTracker implements ProgressTracker {
  async getValue(userId: number, timeframe?: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(*) as count 
       FROM users u
       JOIN user_stats us ON u.id = us.user_id
       WHERE u.referred_by = $1 AND us.trades_count > 0`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }
}

class SpecialProgressTracker implements ProgressTracker {
  async getValue(userId: number, timeframe?: string): Promise<number> {
    return 0; // Special achievements don't have numeric progress
  }
  
  async checkSpecial(userId: number, achievementId: string, event: AchievementEvent): Promise<boolean> {
    switch (achievementId) {
      case 'early_adopter':
        return this.checkEarlyAdopter(userId);
      case 'weekend_warrior':
        return this.checkWeekendWarrior(userId);
      case 'night_owl':
        return this.checkNightOwl(userId);
      case 'speed_demon':
        return this.checkSpeedDemon(userId, event);
      default:
        return false;
    }
  }
  
  private async checkEarlyAdopter(userId: number): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT created_at FROM users WHERE id = $1',
      [userId]
    );
    
    const createdAt = new Date(result.rows[0].created_at);
    const launchDate = new Date('2025-02-01'); // Set your launch date
    const monthLater = new Date(launchDate);
    monthLater.setMonth(monthLater.getMonth() + 1);
    
    return createdAt >= launchDate && createdAt < monthLater;
  }
  
  private async checkWeekendWarrior(userId: number): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(`
      SELECT COUNT(DISTINCT DATE_TRUNC('week', opened_at)) as weeks
      FROM trades
      WHERE user_id = $1
        AND EXTRACT(DOW FROM opened_at) IN (0, 6)
        AND opened_at >= CURRENT_DATE - INTERVAL '30 days'
    `, [userId]);
    
    return parseInt(result.rows[0].weeks) >= 4;
  }
  
  private async checkNightOwl(userId: number): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM trades
      WHERE user_id = $1
        AND EXTRACT(HOUR FROM opened_at) >= 0
        AND EXTRACT(HOUR FROM opened_at) < 6
    `, [userId]);
    
    return parseInt(result.rows[0].count) >= 10;
  }
  
  private async checkSpeedDemon(userId: number, event: AchievementEvent): Promise<boolean> {
    if (event.type !== 'trade_executed') return false;
    
    const pool = getPool();
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM trades
      WHERE user_id = $1
        AND opened_at >= NOW() - INTERVAL '10 minutes'
    `, [userId]);
    
    return parseInt(result.rows[0].count) >= 10;
  }
}

// Event types
export interface AchievementEvent {
  type: 'trade_executed' | 'trade_closed' | 'level_up' | 'referral_completed' | 'daily_login';
  userId: number;
  data: any;
}