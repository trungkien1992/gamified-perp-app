// src/__tests__/mocks/extendedAPI.ts
import { jest } from '@jest/globals';
// In your test-utils or where mockExtendedAPI is defined
// Example assuming it's a simple mock object
export const mockExtendedAPI = {
  onPost: jest.fn(() => mockExtendedAPI), // Return itself for chaining
  reply: jest.fn((statusCode: number, data?: any) => { // Correct signature
    // You might want to store calls or simulate behavior here
    return mockExtendedAPI; // Return itself for chaining
  }),
  // Add other methods (onGet, onPut, etc.) if your tests use them
  // Example:
  onGet: jest.fn(() => mockExtendedAPI),
};

// Or if it's a function that creates the mock:
// export const createMockExtendedAPI = () => ({ /* ... */ });
// And in trading.test.ts, you'd do:
// import { createMockExtendedAPI } from '../mocks/extendedAPI';
// const mockExtendedAPI = createMockExtendedAPI();