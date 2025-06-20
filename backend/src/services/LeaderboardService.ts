import { Pool } from 'pg';
import Redis from 'ioredis';
import { getPool } from '../database/connection';
import { getRedis } from './redis';
import logger from '../utils/logger';

export interface LeaderboardEntry {
    userId: number;
    username: string;
    walletAddress: string;
    xp: number;
    rank: number;
    level: number;
}

export interface UserStats {
    userId: number;
    username: string;
    xp_total: number;
    level: number;
}


export class LeaderboardService {
  private pool: Pool;
  private redis: Redis;

  constructor(pool: Pool, redis: Redis) {
    this.pool = pool;
    this.redis = redis;
  }
  
  private getLeaderboardKey(type: 'global' | 'weekly' | 'monthly'): string {
    const now = new Date();
    switch(type) {
        case 'weekly':
            // Note: This is a simple week calculation. Moment.js or date-fns would be more robust.
            return `leaderboard:weekly:${now.getFullYear()}-${now.getUTCMonth() + 1}-${Math.ceil(now.getUTCDate() / 7)}`;
        case 'monthly':
            return `leaderboard:monthly:${now.getFullYear()}-${now.getUTCMonth() + 1}`;
        case 'global':
        default:
            return 'leaderboard:global';
    }
  }

  /**
   * Fetches the leaderboard from Redis and enriches it with user data from PostgreSQL.
   * @param {'global' | 'weekly' | 'monthly'} type - The type of leaderboard.
   * @param {number} [limit=100] - The number of users to return.
   * @returns {Promise<LeaderboardEntry[]>} - The formatted leaderboard.
   */
  async getLeaderboard(type: 'global' | 'weekly' | 'monthly', limit: number = 100): Promise<LeaderboardEntry[]> {
    const key = this.getLeaderboardKey(type);
    
    try {
      // Fetch user IDs and scores from Redis sorted set (descending order)
      const results = await this.redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
      
      if (!results.length) {
        return [];
      }
      
      const userIds: number[] = [];
      const userScores: { [key: number]: number } = {};
      
      for (let i = 0; i < results.length; i += 2) {
        const userId = parseInt(results[i], 10);
        const score = parseInt(results[i+1], 10);
        userIds.push(userId);
        userScores[userId] = score;
      }
      
      if (!userIds.length) return [];

      // Fetch user details from PostgreSQL for the retrieved user IDs
      // Note: Using ANY($1::int[]) is efficient for querying a list of IDs.
      const userQuery = `
          SELECT u.id, u.username, u.wallet_address, us.level
          FROM users u
          LEFT JOIN user_stats us ON u.id = us.user_id
          WHERE u.id = ANY($1::int[])
      `;
      const { rows: userDetails } = await this.pool.query(userQuery, [userIds]);
      
      // Combine Redis and PostgreSQL data
      const leaderboard: LeaderboardEntry[] = userDetails.map((user, index) => ({
        rank: index + 1,
        userId: user.id,
        username: user.username,
        walletAddress: user.wallet_address,
        level: user.level || 1,
        xp: userScores[user.id],
      }));
      
      return leaderboard;

    } catch (err) {
      logger.error(`Error fetching leaderboard '${type}':`, err);
      throw err;
    }
  }
  
  /**
   * Gets a specific user's stats and rank.
   * @param {number} userId - The user's ID.
   * @returns {Promise<UserStats | null>}
   */
   async getUserStats(userId: number): Promise<UserStats | null> {
       try {
        const query = `
            SELECT u.id, u.username, us.xp_total, us.level 
            FROM users u
            JOIN user_stats us ON u.id = us.user_id
            WHERE u.id = $1
        `;
        const { rows } = await this.pool.query(query, [userId]);
        
        if (rows.length === 0) {
            return null;
        }

        const user = rows[0];

        return {
            userId: user.id,
            username: user.username,
            xp_total: user.xp_total,
            level: user.level
        };

       } catch(err) {
            logger.error(`Error fetching user stats for user ${userId}:`, err);
            return null;
       }
   }
}

// Singleton instance
export const leaderboardService = new LeaderboardService(getPool(), getRedis());
