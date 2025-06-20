import dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

import { getPool } from './database/connection';
import { getRedis } from './services/redis';
import { startServer } from './server';
import logger from './utils/logger';

/**
 * Main application entry point.
 * Initializes connections and starts the server.
 */
const main = async () => {
  try {
    logger.info('Starting application...');
    
    // Initialize database and Redis connections on startup
    getPool();
    getRedis();

    // Start the Express server
    startServer();
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
};

main();
