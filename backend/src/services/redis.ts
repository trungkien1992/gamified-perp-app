import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

let redis: Redis;
export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL as string);
  }
  return redis;
}
