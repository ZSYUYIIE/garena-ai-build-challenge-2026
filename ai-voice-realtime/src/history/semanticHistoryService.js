import { semanticSearchResultSchema } from "./historySchemas.js";

export class SemanticHistoryService {
  searchSimilarEvents(_input) {
    throw new Error("SemanticHistoryService.searchSimilarEvents() is not implemented");
  }
}

export class UnavailableSemanticHistoryService extends SemanticHistoryService {
  searchSimilarEvents() {
    return {
      dataOrigin: "empty",
      retrievalMode: "unavailable",
      results: [],
      warning: "Similar moments are not configured. Session history remains available.",
    };
  }
}

/** Deterministic development adapter. It does not generate embeddings or rank data. */
export class DemoSemanticHistoryService extends SemanticHistoryService {
  constructor({ results = [], domainsBySession = new Map() } = {}) {
    super();
    this.results = results.map((result) => semanticSearchResultSchema.parse(result));
    this.domainsBySession = new Map(domainsBySession);
  }

  searchSimilarEvents({ query, sessionId, domain, limit = 10 }) {
    const queryTerms = searchTerms(query);
    const results = this.results
      .filter((result) => !sessionId || result.sessionId === sessionId)
      .filter((result) => !domain || (
        this.domainsBySession.get(result.sessionId)?.toLocaleLowerCase()
          === domain.toLocaleLowerCase()
      ))
      .filter((result) => queryTerms.length === 0 || queryTerms.some((term) =>
        searchableResultText(result).includes(term),
      ))
      .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
      .slice(0, limit);
    return { dataOrigin: "demo", retrievalMode: "semantic", results };
  }
}

function searchTerms(query) {
  const direct = String(query ?? "")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((term) => term.replace(/(?:ing|ies|es|s)$/u, ""))
    .filter((term) => term.length >= 3 && !["similar", "moment"].includes(term)) ?? [];
  const expanded = new Set(direct);
  for (const term of direct) {
    if (term.startsWith("attack") || term.startsWith("opportunit")) {
      ["attack", "counterattack", "shot", "pressure"].forEach((value) => expanded.add(value));
    }
    if (term.startsWith("save") || term.startsWith("goalkeeper")) {
      ["save", "goalkeeper", "block", "stop"].forEach((value) => expanded.add(value));
    }
  }
  return [...expanded];
}

function searchableResultText(result) {
  return [
    result.description,
    result.eventType.replaceAll("_", " "),
    ...result.entities,
    ...result.topics,
  ].join(" ").toLocaleLowerCase();
}
