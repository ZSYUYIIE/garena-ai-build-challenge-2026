const DEFAULT_MAX_PENDING = 256;

/** Keeps history work outside EventStore.record() and the browser response path. */
export class HistoryArchiveQueue {
  constructor({
    historyService,
    maxPending = DEFAULT_MAX_PENDING,
    onError = () => {},
    queueTask = queueMicrotask,
  }) {
    if (!historyService) throw new TypeError("HistoryArchiveQueue requires a history service");
    this.historyService = historyService;
    this.maxPending = Math.max(1, Number(maxPending) || DEFAULT_MAX_PENDING);
    this.onError = onError;
    this.queueTask = queueTask;
    this.jobs = [];
    this.processing = false;
    this.scheduled = false;
    this.idleWaiters = new Set();
  }

  startSession(input) {
    return this.enqueue("start_session", () => this.historyService.startSession(input));
  }

  archiveEvent(input) {
    return this.enqueue("archive_event", () => this.historyService.archiveEvent(input));
  }

  finishSession(input) {
    return this.enqueue("finish_session", () => this.historyService.finishSession(input));
  }

  enqueue(kind, run) {
    if (this.jobs.length >= this.maxPending) {
      this.reportError(new Error("History archive queue capacity exceeded"), kind);
      return false;
    }
    this.jobs.push({ kind, run });
    if (!this.processing && !this.scheduled) {
      this.scheduled = true;
      this.queueTask(() => {
        this.scheduled = false;
        void this.process();
      });
    }
    return true;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift();
        try {
          await job.run();
        } catch (error) {
          this.reportError(error, job.kind);
        }
      }
    } finally {
      this.processing = false;
      if (this.jobs.length) {
        this.queueTask(() => void this.process());
      } else {
        for (const resolve of this.idleWaiters) resolve(true);
        this.idleWaiters.clear();
      }
    }
  }

  async drain({ timeoutMs = 2_000 } = {}) {
    if (!this.processing && !this.scheduled && this.jobs.length === 0) return true;
    let timeout;
    const idle = new Promise((resolve) => this.idleWaiters.add(resolve));
    const timedOut = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
    });
    const drained = await Promise.race([idle, timedOut]);
    clearTimeout(timeout);
    return drained;
  }

  reportError(error, operation) {
    try {
      this.onError({
        operation,
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // History telemetry must never affect realtime behavior.
    }
  }
}
