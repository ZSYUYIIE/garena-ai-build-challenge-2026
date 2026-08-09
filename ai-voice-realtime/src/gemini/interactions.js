const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

function interactionContent(payload, type) {
  return (payload?.steps ?? [])
    .filter((step) => step?.type === "model_output")
    .flatMap((step) => Array.isArray(step?.content) ? step.content : [])
    .filter((content) => content?.type === type);
}

export class GeminiInteractions {
  constructor({ apiKey = "", fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async create(body, { signal } = {}) {
    if (!this.apiKey) throw new Error("Deep Research needs GOOGLE_API_KEY in the backend environment.");
    const response = await this.fetchImpl(INTERACTIONS_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": this.apiKey,
        "Api-Revision": API_REVISION,
      },
      body: JSON.stringify({ ...body, store: false }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = String(payload?.error?.message ?? "request failed").slice(0, 240);
      throw new Error(`Gemini interaction failed (${response.status}): ${detail}`);
    }
    return payload;
  }

  text(payload) {
    return interactionContent(payload, "text")
      .map((content) => String(content?.text ?? ""))
      .join("")
      .trim();
  }

  audio(payload) {
    const contents = interactionContent(payload, "audio").filter((content) => (
      typeof content?.data === "string" && content.data.length > 0
    ));
    if (contents.length === 0) return null;
    const mimeType = contents.find((content) => typeof content.mime_type === "string")?.mime_type
      ?? "audio/pcm;rate=24000";
    const data = Buffer.concat(contents.map((content) => Buffer.from(content.data, "base64"))).toString("base64");
    return {
      data,
      mimeType,
    };
  }
}
