import { jest } from '@jest/globals';
export const createMockRedis = () => ({
  exists: jest.fn().mockResolvedValue(0),
  setex: jest.fn(),
  zadd: jest.fn(),
  pipeline: jest.fn().mockReturnThis(),
  exec: jest.fn(),
});
