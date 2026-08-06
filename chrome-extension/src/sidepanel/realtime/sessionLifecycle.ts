export type SessionGenerationGuard = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
};

export type MicrophoneTurnOwnership<T extends {
  turnId: string;
  packets: unknown[];
  bytes: number;
}> = {
  claim: (turn: T) => void;
  current: () => T | null;
  isCurrent: (turn: T) => boolean;
  retire: (turnId?: string) => T | null;
  clear: () => void;
};

/** Owns one local microphone turn and invalidates queued callbacks atomically. */
export function createMicrophoneTurnOwnership<T extends {
  turnId: string;
  packets: unknown[];
  bytes: number;
}>(): MicrophoneTurnOwnership<T> {
  let current: T | null = null;
  const clearBuffers = (turn: T) => {
    turn.packets = [];
    turn.bytes = 0;
  };

  return {
    claim(turn) {
      if (current && current !== turn) clearBuffers(current);
      current = turn;
    },
    current() {
      return current;
    },
    isCurrent(turn) {
      return current === turn;
    },
    retire(turnId) {
      if (!current || (turnId !== undefined && current.turnId !== turnId)) return null;
      const retired = current;
      current = null;
      clearBuffers(retired);
      return retired;
    },
    clear() {
      if (current) clearBuffers(current);
      current = null;
    },
  };
}

export function createSessionGenerationGuard(): SessionGenerationGuard {
  let currentGeneration = 0;

  return {
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
    },
    isCurrent(generation) {
      return generation === currentGeneration;
    },
  };
}

export type SessionCallbackGate = {
  allows: () => boolean;
  run: (callback: () => void) => boolean;
  close: () => void;
};

/** Prevents queued media/worklet callbacks from crossing a session generation. */
export function createSessionCallbackGate(
  isCurrent: () => boolean,
): SessionCallbackGate {
  let closed = false;
  return {
    allows() {
      return !closed && isCurrent();
    },
    run(callback) {
      if (closed || !isCurrent()) return false;
      callback();
      return true;
    },
    close() {
      closed = true;
    },
  };
}

export type SessionResourceLifecycle = {
  callbacks: SessionCallbackGate;
  register: (cleanup: () => void | Promise<void>) => Promise<void> | null;
  release: () => Promise<void>;
};

/** Owns one session generation's composed resources and exact-once release. */
export function createSessionResourceLifecycle(
  isCurrent: () => boolean,
): SessionResourceLifecycle {
  const callbacks = createSessionCallbackGate(isCurrent);
  const cleanups: Array<() => void | Promise<void>> = [];
  let releasePromise: Promise<void> | null = null;
  const settleCleanup = (cleanup: () => void | Promise<void>) => {
    try {
      return Promise.resolve(cleanup()).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  return {
    callbacks,
    register(cleanup) {
      if (typeof cleanup !== "function") throw new TypeError("cleanup must be a function");
      if (releasePromise) return settleCleanup(cleanup);
      cleanups.push(cleanup);
      return null;
    },
    release() {
      if (releasePromise) return releasePromise;
      callbacks.close();
      const owned = cleanups.splice(0).reverse();
      releasePromise = Promise.allSettled(owned.map(settleCleanup)).then(() => undefined);
      return releasePromise;
    },
  };
}

export type RevisionGuard = {
  snapshot: () => number;
  markChanged: () => void;
  isCurrent: (revision: number) => boolean;
};

export function createRevisionGuard(): RevisionGuard {
  let currentRevision = 0;

  return {
    snapshot() {
      return currentRevision;
    },
    markChanged() {
      currentRevision += 1;
    },
    isCurrent(revision) {
      return revision === currentRevision;
    },
  };
}

export function shouldSyncIdleGuidance(
  isIdle: boolean,
  previousGuidance: string | null,
  nextGuidance: string,
): boolean {
  return isIdle && previousGuidance !== nextGuidance;
}
