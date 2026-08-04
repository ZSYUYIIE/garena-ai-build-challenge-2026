const LIMITS = Object.freeze({
  video_frame: { count: 2, windowMs: 1_000 },
  typed_question: { count: 1, windowMs: 2_000 },
});

export class SessionRateLimiter {
  constructor() {
    this.acceptedAt = new Map();
  }

  accept(type, now = Date.now()) {
    const limit = LIMITS[type];
    if (!limit) return { allowed: true, retryAfterMs: 0 };

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
}
