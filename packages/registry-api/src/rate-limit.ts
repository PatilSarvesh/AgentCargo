export type RegistryRateLimitBucket = "auth" | "search" | "reporting" | "publishing" | "moderation";

export interface RegistryRateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RegistryRateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RegistryRateLimiter {
  consume(input: {
    key: string;
    limit: number;
    windowMs: number;
  }): RegistryRateLimitDecision | Promise<RegistryRateLimitDecision>;
}

export class RegistryRateLimiterError extends Error {
  readonly code: "REGISTRY_RATE_LIMITER_CAPACITY" | "REGISTRY_RATE_LIMITER_INVALID";

  constructor(code: "REGISTRY_RATE_LIMITER_CAPACITY" | "REGISTRY_RATE_LIMITER_INVALID", message: string) {
    super(message);
    this.name = "RegistryRateLimiterError";
    this.code = code;
  }
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface InMemoryRegistryRateLimiterOptions {
  maxKeys?: number;
  now?: () => number;
}

/**
 * A bounded fixed-window limiter for a single API process. Deployments that
 * need cross-instance coordination can inject a shared implementation through
 * `RegistryRateLimiter`; this class never grows beyond `maxKeys` entries.
 */
export class InMemoryRegistryRateLimiter implements RegistryRateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>();
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor(options: InMemoryRegistryRateLimiterOptions = {}) {
    this.#maxKeys = options.maxKeys ?? 10_000;
    this.#now = options.now ?? (() => Date.now());
    if (!Number.isSafeInteger(this.#maxKeys) || this.#maxKeys < 1 || this.#maxKeys > 1_000_000) {
      throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_INVALID", "The rate limiter key capacity is invalid.");
    }
  }

  get size(): number {
    return this.#buckets.size;
  }

  consume(input: { key: string; limit: number; windowMs: number }): RegistryRateLimitDecision {
    if (typeof input.key !== "string" || input.key.length < 1 || input.key.length > 256 || /[\u0000-\u001f\u007f]/.test(input.key)) {
      throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_INVALID", "The rate limiter key is invalid.");
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000_000) {
      throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_INVALID", "The rate limiter limit is invalid.");
    }
    if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1_000 || input.windowMs > 86_400_000) {
      throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_INVALID", "The rate limiter window is invalid.");
    }

    const now = this.#now();
    if (!Number.isFinite(now)) {
      throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_INVALID", "The rate limiter clock is invalid.");
    }
    let bucket = this.#buckets.get(input.key);
    if (bucket && now >= bucket.resetAt) {
      this.#buckets.delete(input.key);
      bucket = undefined;
    }
    if (!bucket) {
      this.#prune(now);
      if (this.#buckets.size >= this.#maxKeys) {
        throw new RegistryRateLimiterError("REGISTRY_RATE_LIMITER_CAPACITY", "The rate limiter capacity is exhausted.");
      }
      bucket = { count: 0, resetAt: now + input.windowMs };
      this.#buckets.set(input.key, bucket);
    }

    if (bucket.count >= input.limit) {
      return {
        allowed: false,
        limit: input.limit,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      limit: input.limit,
      remaining: Math.max(0, input.limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: 0,
    };
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now >= bucket.resetAt) this.#buckets.delete(key);
    }
  }
}
