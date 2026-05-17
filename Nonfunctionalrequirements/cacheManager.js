'use strict';

const Redis = require('ioredis');
const logger = require('../utils/logger');

/**
 * Redis Cache Manager
 * Handles all caching operations for sub-2-second response times
 */
class CacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.prefix = process.env.REDIS_KEY_PREFIX || 'farm:';
    this.defaultTTL = parseInt(process.env.REDIS_DEFAULT_TTL) || 300;
    this.searchTTL = parseInt(process.env.REDIS_SEARCH_TTL) || 120;
    this.stats = { hits: 0, misses: 0, errors: 0 };
  }

  /**
   * Initialize Redis connection with retry and failover
   */
  async connect() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB) || 0,
      keyPrefix: this.prefix,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        logger.warn(`Redis reconnect attempt ${times}, delay ${delay}ms`);
        if (times > 20) return null; // Stop retrying
        return delay;
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      connectTimeout: 5000,
      commandTimeout: 2000,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('✅ Redis connected');
    });

    this.client.on('error', (err) => {
      this.isConnected = false;
      this.stats.errors++;
      logger.error(`Redis error: ${err.message}`);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis connection closed');
    });

    try {
      await this.client.ping();
    } catch (err) {
      logger.warn('Redis unavailable — running without cache (degraded mode)');
    }
  }

  /**
   * Build a namespaced cache key
   */
  buildKey(...parts) {
    return parts.join(':');
  }

  /**
   * Build a deterministic key from search parameters
   */
  buildSearchKey(namespace, params) {
    const sorted = Object.keys(params)
      .sort()
      .filter((k) => params[k] !== undefined && params[k] !== '')
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return this.buildKey(namespace, Buffer.from(sorted).toString('base64url'));
  }

  /**
   * Get value from cache
   */
  async get(key) {
    if (!this.isConnected) return null;
    try {
      const data = await this.client.get(key);
      if (data) {
        this.stats.hits++;
        return JSON.parse(data);
      }
      this.stats.misses++;
      return null;
    } catch (err) {
      this.stats.errors++;
      logger.error(`Cache GET error [${key}]: ${err.message}`);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) return false;
    try {
      await this.client.setex(key, ttl, JSON.stringify(value));
      return true;
    } catch (err) {
      this.stats.errors++;
      logger.error(`Cache SET error [${key}]: ${err.message}`);
      return false;
    }
  }

  /**
   * Delete one or more keys (supports glob patterns)
   */
  async del(...keys) {
    if (!this.isConnected) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      logger.error(`Cache DEL error: ${err.message}`);
    }
  }

  /**
   * Invalidate all keys matching a pattern
   */
  async invalidatePattern(pattern) {
    if (!this.isConnected) return;
    try {
      // Use SCAN instead of KEYS for production safety
      let cursor = '0';
      const fullPattern = `${this.prefix}${pattern}`;
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          // Strip prefix before deleting (ioredis adds it back)
          const stripped = keys.map((k) => k.replace(this.prefix, ''));
          await this.client.del(...stripped);
        }
      } while (cursor !== '0');
    } catch (err) {
      logger.error(`Cache invalidate pattern error [${pattern}]: ${err.message}`);
    }
  }

  /**
   * Cache-aside pattern wrapper
   * Returns cached value or executes fn and caches result
   */
  async remember(key, fn, ttl = this.defaultTTL) {
    const cached = await this.get(key);
    if (cached !== null) return { data: cached, fromCache: true };

    const data = await fn();
    await this.set(key, data, ttl);
    return { data, fromCache: false };
  }

  /**
   * Tag-based cache invalidation
   * Associates keys with tags for bulk invalidation
   */
  async tagSet(tags, key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) return false;
    const pipeline = this.client.pipeline();
    pipeline.setex(key, ttl, JSON.stringify(value));
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, ttl + 60); // Tag lives slightly longer than data
    }
    await pipeline.exec();
    return true;
  }

  async invalidateTags(...tags) {
    if (!this.isConnected) return;
    const pipeline = this.client.pipeline();
    const keys = [];
    for (const tag of tags) {
      const members = await this.client.smembers(`tag:${tag}`);
      keys.push(...members, `tag:${tag}`);
    }
    if (keys.length) pipeline.del(...keys);
    await pipeline.exec();
  }

  /**
   * Cache statistics for monitoring
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : '0%',
      connected: this.isConnected,
    };
  }

  async disconnect() {
    if (this.client) await this.client.quit();
  }
}

// Singleton
const cache = new CacheManager();
module.exports = cache;
