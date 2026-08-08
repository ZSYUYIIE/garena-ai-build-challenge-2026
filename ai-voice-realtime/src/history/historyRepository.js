/**
 * Storage contract for chronological StreamSense history.
 *
 * Implementations may be synchronous or asynchronous. Callers always await
 * results so a teammate-owned durable adapter can implement the same surface.
 */
export class HistoryRepository {
  upsertSession(_session) {
    throw new Error("HistoryRepository.upsertSession() is not implemented");
  }

  archiveEvent(_event) {
    throw new Error("HistoryRepository.archiveEvent() is not implemented");
  }

  listSessions(_options) {
    throw new Error("HistoryRepository.listSessions() is not implemented");
  }

  getSession(_sessionId) {
    throw new Error("HistoryRepository.getSession() is not implemented");
  }

  listSessionEvents(_sessionId, _options) {
    throw new Error("HistoryRepository.listSessionEvents() is not implemented");
  }

  close() {}
}
