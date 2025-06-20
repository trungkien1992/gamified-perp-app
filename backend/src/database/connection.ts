import { Pool } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool;

export async function connectDatabase(): Promise<void> {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'perps_gamified',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  try {
    await pool.connect();
    logger.info('✅ Connected to PostgreSQL');
    await createTables();
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw error;
  }
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}

async function createTables(): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(66) UNIQUE NOT NULL,
        username VARCHAR(50) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        session_key VARCHAR(255),
        session_expires_at TIMESTAMP
      )
    `);
    
    // User stats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_stats (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        xp_total INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        trades_count INTEGER DEFAULT 0,
        wins_count INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        total_volume DECIMAL(20, 2) DEFAULT 0,
        total_pnl DECIMAL(20, 2) DEFAULT 0
      )
    `);
    
    // Trades table
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        asset VARCHAR(20) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        size DECIMAL(20, 2) NOT NULL,
        entry_price DECIMAL(20, 8) NOT NULL,
        exit_price DECIMAL(20, 8),
        pnl DECIMAL(20, 2),
        status VARCHAR(20) DEFAULT 'open',
        is_mock BOOLEAN DEFAULT false,
        opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP,
        tx_hash VARCHAR(66)
      )
    `);
    
    // XP logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS xp_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action_type VARCHAR(50) NOT NULL,
        xp_amount INTEGER NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Achievements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        achievement_type VARCHAR(50) NOT NULL,
        unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        nft_token_id VARCHAR(100),
        metadata JSONB,
        UNIQUE(user_id, achievement_type)
      )
    `);
    
    // Leaderboard snapshots table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
        id SERIAL PRIMARY KEY,
        period_type VARCHAR(20) NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        rankings JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_xp_logs_user_id ON xp_logs(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements(user_id)');
    
    await client.query('COMMIT');
    logger.info('✅ Database tables created successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Failed to create tables:', error);
    throw error;
  } finally {
    client.release();
  }
}