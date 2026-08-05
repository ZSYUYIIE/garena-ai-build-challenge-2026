const LIMITS = Object.freeze({
  video_frame: { count: 1, windowMs: 1_000, burst: 2 },
  typed_question: { count: 1, windowMs: 2_000 },
  audio_microphone: { count: 75, windowMs: 1_000 },
  audio_tab: { count: 15, windowMs: 1_000 },
});

export class SessionRateLimiter {
  constructor() {
    this.acceptedAt = new Map();
    this.buckets = new Map();
  }

  accept(type, now = Date.now()) {
    const limit = LIMITS[type];
    if (!limit) return { allowed: true, retryAfterMs: 0 };
    if (limit.burst) return this.#acceptTokenBucket(type, limit, now);

    const previous = this.acceptedAt.get(type) ?? [];
    const active = previous.filter((acceptedAt) => now - acceptedAt < limit.windowMs);
    if (active.length >= limit.count) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, limit.windowMs - (now - active[0])),
      };
    }

    active.push(now);
    this.acceptedAt.set(type, active);
    return { allowed: true, retryAfterMs: 0 };
  }

  #acceptTokenBucket(type, limit, now) {
    const previous = this.buckets.get(type) ?? {
      tokens: limit.burst,
      updatedAt: now,
    };
    const elapsedMs = Math.max(0, now - previous.updatedAt);
    const refillPerMs = limit.count / limit.windowMs;
    const tokens = Math.min(
      limit.burst,
      previous.tokens + elapsedMs * refillPerMs,
    );
    if (tokens < 1) {
      this.buckets.set(type, { tokens, updatedAt: now });
      return {
        allowed: false,
        retryAfterMs: Math.max(1, Math.ceil((1 - tokens) / refillPerMs)),
      };
    }
    this.buckets.set(type, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  reset() {
    this.acceptedAt.clear();
    this.buckets.clear();
  }
}
