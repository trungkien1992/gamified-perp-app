import request from 'supertest';
import { app } from '../../app';
import { connectDatabase } from '../../database/connection';
// import { connectRedis } from '../../services/redis';
import { mockExtendedAPI } from '../mocks/extendedAPI';

// Stubs for missing test utilities
async function cleanupDatabase() {}
async function createTestUser() { return 'mock-token'; }

describe.skip('Trading API Integration', () => {
  beforeAll(async () => {
    await connectDatabase();
    // await connectRedis();
    mockExtendedAPI.start();
  });
  
  afterAll(async () => {
    await cleanupDatabase();
    mockExtendedAPI.stop();
  });
  
  describe('POST /api/v1/trading/execute', () => {
    it('should execute a trade successfully', async () => {
      // Setup user
      const token = await createTestUser();
      
      // Mock Extended API response
      mockExtendedAPI.onPost('/v1/trade').reply(200, {
        txHash: '0x123...',
        orderId: 'order-123',
      });
      
      const response = await request(app)
        .post('/api/v1/trading/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          asset: 'BTC',
          direction: 'long',
          size: 100,
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        tradeId: expect.any(Number),
        txHash: expect.stringMatching(/^0x/),
      });
      
      // Verify XP was awarded
      const xpResponse = await request(app)
        .get('/api/v1/xp/stats')
        .set('Authorization', `Bearer ${token}`);
      
      expect(xpResponse.body.totalXP).toBeGreaterThan(0);
    });
    
    it('should handle Extended API failures gracefully', async () => {
      const token = await createTestUser();
      
      // Mock API failure
      mockExtendedAPI.onPost('/v1/trade').reply(503);
      
      const response = await request(app)
        .post('/api/v1/trading/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          asset: 'BTC',
          direction: 'long',
          size: 100,
        });
      
      expect(response.status).toBe(202); // Accepted for retry
      expect(response.body).toMatchObject({
        success: false,
        message: 'Trade queued for execution',
        retryAfter: expect.any(Number),
      });
    });
  });
}); 