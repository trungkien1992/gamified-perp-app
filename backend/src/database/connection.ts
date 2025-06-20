import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

let pool: Pool;
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: parseInt(process.env.PG_PORT || '5432', 10),
      ssl: process.env.PG_HOST !== 'localhost' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}
