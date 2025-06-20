import express from 'express';
// Correct the import path to be local to the current directory
import { XPService } from './XPService'; 

const app = express();

// In a real app, you'd get these from connection pools.
const fakeDbClient = {};
const fakeRedisClient = {};

// Create an instance of our service
export const xpService = new XPService(fakeDbClient, fakeRedisClient);

app.get('/test-xp', async (req, res) => {
  const result = await xpService.awardXP(1);
  res.status(200).json(result);
});

export default app;