const EXA_SEARCH_URL = "https://api.exa.ai/search";
const MAX_RESULTS = 6;
const MAX_SOURCE_TEXT = 2_000;

function cleanText(value, limit = MAX_SOURCE_TEXT) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function publicHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export class ExaDeepResearch {
  constructor({ apiKey = "", fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async search(query, { signal, onProgress = () => {} } = {}) {
    if (!this.apiKey) throw new Error("Deep Research needs EXA_API_KEY in the backend environment.");
    const normalizedQuery = cleanText(query, 500);
    if (!normalizedQuery) throw new Error("A research query is required.");

    onProgress({ stage: "search", status: "active", detail: `Searching for: ${normalizedQuery}` });
    const response = await this.fetchImpl(EXA_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({
        query: normalizedQuery,
        type: "deep",
        numResults: MAX_RESULTS,
        contents: { highlights: { maxCharacters: MAX_SOURCE_TEXT } },
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa search failed (${response.status}).`);
    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    onProgress({ stage: "search", status: "completed", detail: `Found ${results.length} sources.` });
    onProgress({ stage: "review", status: "active", detail: "Reviewing the most relevant source passages." });

    const sources = results.flatMap((result, index) => {
      const url = publicHttpUrl(result?.url);
      if (!url) return [];
      const highlights = Array.isArray(result?.highlights) ? result.highlights.join(" ") : "";
      const excerpt = cleanText(highlights || result?.text || result?.summary);
      if (!excerpt) return [];
      return [{ index: index + 1, title: cleanText(result?.title || url, 240), url, excerpt }];
    });
    if (sources.length === 0) throw new Error("The web search returned no readable public sources.");
    onProgress({ stage: "review", status: "completed", detail: `Reviewed ${sources.length} source passages.` });
    return {
      query: normalizedQuery,
      instruction: "Answer from these sources. Cite factual claims inline using [1], [2], and so on. Include a short Sources list with title and URL. State uncertainty or source disagreement.",
      sources,
    };
  }
}
