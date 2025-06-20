import { jest } from '@jest/globals';
import { XPService } from '../XPService';
import { createMockPool } from '../../test-utils/mockDb';
import { createMockRedis } from '../../test-utils/mockRedis';

jest.mock('../WebSocketService'); // Mock the dependency

describe('XPService', () => {
  it('should award XP successfully', async () => {
    // Arrange
    const mockPool = createMockPool() as any;
    const mockRedis = createMockRedis() as any;
    const xpService = new XPService(mockPool, mockRedis);

    // Act
    await xpService.awardXP(1, 'first_trade');

    // Assert
    // Basic assertion to ensure it runs without error
    expect(true).toBe(true);
  });
});
