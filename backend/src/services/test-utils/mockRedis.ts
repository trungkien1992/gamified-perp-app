// src/test-utils/mockRedis.ts (or similar)
import { jest } from '@jest/globals'; // Ensure jest is imported if not global

export const createMockRedis = () => {
  return {
    // Cooldown and basic key operations
    exists: jest.fn((key: string) => Promise.resolve(0)), // Returns 0 (not exists) or 1 (exists)
    setex: jest.fn((key: string, seconds: number, value: string) => Promise.resolve('OK')), // Returns 'OK'

    // Leaderboard operations
    zadd: jest.fn((key: string, score: number, member: string) => Promise.resolve(1)), // Returns number of elements added
    zrevrange: jest.fn((key: string, start: number, stop: number, withScores?: 'WITHSCORES') => Promise.resolve([])), // Returns string[] (members and scores if WITHSCORES)

    // XP Intent Queue operations
    lpush: jest.fn((key: string, value: string) => Promise.resolve(1)), // Returns length of the list
    llen: jest.fn((key: string) => Promise.resolve(0)), // Returns length of the list
    rpop: jest.fn((key: string) => Promise.resolve(null)), // Returns element (string) or null

    // If you have getRedis() returning this mock directly in src/services/redis.ts for tests
    // you might need to adjust src/services/redis.ts to conditionalize getRedis()
    // based on environment (e.g., process.env.NODE_ENV === 'test')
  };
};

// If you have `jest.mock('../../database/connection')` in your XPService.test.ts,
// you might need a similar mock for getRedis as well, if it's imported from somewhere else.
// However, the error specifically points to the `redis` variable inside XPService.ts.
// The most common pattern is that `getRedis()` in XPService.ts is returning this mock in tests.