import request from 'supertest';
import app from '../../app'; // Import the app
import { tradingService } from '../../app'; // Import the specific instance

// Mock the instance's methods
jest.mock('../../app', () => {
  const originalModule = jest.requireActual('../../app');
  return {
    __esModule: true,
    ...originalModule,
    tradingService: {
      executeTrade: jest.fn(),
    },
  };
});

describe('POST /trade', () => {
  it('should return 200 on successful trade', async () => {
    // Arrange
    (tradingService.executeTrade as jest.Mock).mockResolvedValue(true);

    // Act
    const response = await request(app).post('/trade');

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Trade executed');
  });
});
