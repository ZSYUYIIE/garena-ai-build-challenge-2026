export type SessionGenerationGuard = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
};

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
