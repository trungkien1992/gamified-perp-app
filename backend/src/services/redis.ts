export function getRedis() {
  const fn = () => {};
  return {
    get: fn,
    set: fn,
    exists: fn,
    del: fn,
    expire: fn,
    sadd: fn,
    srem: fn,
    zrevrank: fn,
    zscore: fn,
    setex: fn,
    zadd: fn,
    lpush: fn,
  };
} 