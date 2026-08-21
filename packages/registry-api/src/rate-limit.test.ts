import { describe, expect, it } from "vitest";
import { InMemoryRegistryRateLimiter, RegistryRateLimiterError } from "./rate-limit.js";

describe("InMemoryRegistryRateLimiter", () => {
  it("enforces a fixed window and reports retry metadata", () => {
    let now = 1_000;
    const limiter = new InMemoryRegistryRateLimiter({ now: () => now });

    expect(limiter.consume({ key: "search:/v1/search:127.0.0.1", limit: 2, windowMs: 10_000 })).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume({ key: "search:/v1/search:127.0.0.1", limit: 2, windowMs: 10_000 })).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume({ key: "search:/v1/search:127.0.0.1", limit: 2, windowMs: 10_000 })).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 10,
    });

    now = 11_000;
    expect(limiter.consume({ key: "search:/v1/search:127.0.0.1", limit: 2, windowMs: 10_000 }).allowed).toBe(true);
  });

  it("rejects new keys when bounded capacity is exhausted", () => {
    const limiter = new InMemoryRegistryRateLimiter({ maxKeys: 1, now: () => 1_000 });
    limiter.consume({ key: "first", limit: 1, windowMs: 10_000 });
    expect(() => limiter.consume({ key: "second", limit: 1, windowMs: 10_000 })).toThrowError(
      expect.objectContaining({ code: "REGISTRY_RATE_LIMITER_CAPACITY" }),
    );
    expect(limiter.size).toBe(1);
  });

  it("rejects invalid policy input without retaining a bucket", () => {
    const limiter = new InMemoryRegistryRateLimiter({ now: () => 1_000 });
    expect(() => limiter.consume({ key: "", limit: 1, windowMs: 10_000 })).toThrowError(RegistryRateLimiterError);
    expect(limiter.size).toBe(0);
  });
});
