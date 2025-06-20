import request from 'supertest';
// Correct the import path to point to app.ts inside the services directory
import app from '../../services/app'; 

// The mock path remains the same and is correct relative to this file
jest.mock('../../services/XPService', () => {
  return {
    XPService: jest.fn().mockImplementation(() => {
      return {
        awardXP: jest.fn().mockResolvedValue({ success: true, newXp: 500 }),
      };
    }),
  };
});


describe('GET /test-xp', () => {
  it('should return a successful response from the mocked service', async () => {
    const response = await request(app).get('/test-xp');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.newXp).toBe(500);
  });
});