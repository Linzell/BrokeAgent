/**
 * Redis Cache Service
 * 
 * Provides caching and rate limiting for external API calls.
 * Falls back gracefully when Redis is not available.
 */

// ============================================
// Types
// ============================================

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// ============================================
// Simple In-Memory Fallback
// ============================================

class MemoryCache {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();
  private rateLimits: Map<string, { count: number; resetAt: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttl: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || now > entry.resetAt) {
      // New window
      this.rateLimits.set(key, {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(now + windowSeconds * 1000),
      };
    }

    if (entry.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(entry.resetAt),
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: limit - entry.count,
      resetAt: new Date(entry.resetAt),
    };
  }
}

// ============================================
// Redis Cache Service
// ============================================

class CacheService {
  private memoryCache: MemoryCache;
  private redisAvailable: boolean = false;
  private redis: any = null;

  constructor() {
    this.memoryCache = new MemoryCache();
    this.initializeRedis();
  }

  private async initializeRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log("[Cache] No REDIS_URL configured, using in-memory cache");
      return;
    }

    try {
      // Dynamic import to avoid bundling issues when Redis is not used
      const { createClient } = await import("redis");
      this.redis = createClient({ url: redisUrl });

      this.redis.on("error", (err: Error) => {
        console.error("[Cache] Redis error:", err.message);
        this.redisAvailable = false;
      });

      this.redis.on("connect", () => {
        console.log("[Cache] Redis connected");
        this.redisAvailable = true;
      });

      await this.redis.connect();
    } catch (error) {
      console.warn("[Cache] Redis not available, using in-memory cache");
      this.redisAvailable = false;
    }
  }

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      let value: string | null = null;

      if (this.redisAvailable && this.redis) {
        value = await this.redis.get(key);
      } else {
        value = await this.memoryCache.get(key);
      }

      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      console.error("[Cache] Get error:", error);
      return null;
    }
  }

  /**
   * Set a cached value
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl || 300; // Default 5 minutes

    try {
      const serialized = JSON.stringify(value);

      if (this.redisAvailable && this.redis) {
        await this.redis.setEx(key, ttl, serialized);
      } else {
        await this.memoryCache.set(key, serialized, ttl);
      }
    } catch (error) {
      console.error("[Cache] Set error:", error);
    }
  }

  /**
   * Delete a cached value
   */
  async del(key: string): Promise<void> {
    try {
      if (this.redisAvailable && this.redis) {
        await this.redis.del(key);
      } else {
        await this.memoryCache.del(key);
      }
    } catch (error) {
      console.error("[Cache] Del error:", error);
    }
  }

  /**
   * Get or set with a factory function
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  /**
   * Check rate limit for a key
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    if (this.redisAvailable && this.redis) {
      try {
        const now = Date.now();
        const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

        const count = await this.redis.incr(windowKey);
        if (count === 1) {
          await this.redis.expire(windowKey, windowSeconds);
        }

        const resetAt = new Date(
          Math.ceil(now / (windowSeconds * 1000)) * windowSeconds * 1000
        );

        return {
          allowed: count <= limit,
          remaining: Math.max(0, limit - count),
          resetAt,
        };
      } catch (error) {
        console.error("[Cache] Rate limit error:", error);
        // Fall through to memory cache
      }
    }

    return this.memoryCache.checkRateLimit(key, limit, windowSeconds);
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{ type: string; available: boolean }> {
    return {
      type: this.redisAvailable ? "redis" : "memory",
      available: true,
    };
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// ============================================
// Singleton instance
// ============================================

export const cache = new CacheService();

// Alias for backwards compatibility
export const cacheService = cache;

// ============================================
// Cache key helpers
// ============================================

export const CacheKeys = {
  quote: (symbol: string) => `quote:${symbol.toUpperCase()}`,
  quotes: (symbols: string[]) =>
    `quotes:${symbols.map((s) => s.toUpperCase()).sort().join(",")}`,
  news: (symbol?: string) => (symbol ? `news:${symbol.toUpperCase()}` : "news:market"),
  social: (symbol?: string) =>
    symbol ? `social:${symbol.toUpperCase()}` : "social:trending",
  rateLimit: (api: string) => `rate:${api}`,
};

// ============================================
// Rate limit presets for different APIs
// ============================================

export const RateLimits = {
  // Yahoo Finance - generous limits
  yahooFinance: { limit: 100, windowSeconds: 60 },
  // FinnHub - 60 calls/minute on free tier
  finnhub: { limit: 55, windowSeconds: 60 },
  // Reddit JSON API - be conservative
  reddit: { limit: 30, windowSeconds: 60 },
};
