import { GeminiInteractions } from "../gemini/interactions.js";
import { deepResearchDemoForQuestion } from "../demo/deepResearchDemo.js";
import { ExaDeepResearch } from "./exaDeepResearch.js";

const DEFAULT_MODEL = "gemini-3.6-flash";
const MAX_SUMMARY_CHARACTERS = 1_000;
const MICROPHONE_SAMPLE_RATE = 16_000;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_CHANNELS = 1;

function bounded(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function answerBody(value) {
  const text = String(value ?? "").trim();
  const sourcesHeading = /(?:^|\n)\s*#{0,6}\s*sources\b/i.exec(text)
    ?? /\s+#{1,6}\s*sources\b/i.exec(text);
  return (sourcesHeading ? text.slice(0, sourcesHeading.index) : text)
    .trim()
    .slice(0, MAX_SUMMARY_CHARACTERS)
    .trim();
}

function spokenSummary(summary) {
  return summary
    .replace(/\s*\[(?:\d+(?:\s*,\s*\d+)*|screen context)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownTitle(value) {
  return bounded(value, 240).replace(/[\[\]]/g, "");
}

function formatAnswer(summary, sources) {
  const sourceList = sources.map((source) => (
    `${source.index}. [${markdownTitle(source.title)}](${source.url})`
  )).join("\n");
  return `${summary}\n\n## Sources\n\n${sourceList}`;
}

function pcm16MonoToWav(pcm) {
  const pcmBytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
  if (pcmBytes.length % 2 !== 0) throw new Error("Microphone PCM must contain complete 16-bit samples.");
  const header = Buffer.alloc(44);
  const byteRate = MICROPHONE_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  const blockAlign = PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(MICROPHONE_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}

export class DeepResearchAnswerService {
  constructor({
    geminiApiKey = "",
    exaApiKey = "",
    model = DEFAULT_MODEL,
    fetchImpl = globalThis.fetch,
    exa,
    interactions,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}) {
    this.model = model;
    this.exa = exa ?? new ExaDeepResearch({ apiKey: exaApiKey, fetchImpl });
    this.interactions = interactions ?? new GeminiInteractions({ apiKey: geminiApiKey, fetchImpl });
    this.sleep = sleep;
  }

  async answer(question, { screenContext = "", signal, onProgress = () => {} } = {}) {
    const normalizedQuestion = bounded(question, 500);
    if (!normalizedQuestion) throw new Error("A research question is required.");

    const demo = deepResearchDemoForQuestion(normalizedQuestion);
    if (demo) {
      const pause = async (milliseconds) => {
        signal?.throwIfAborted?.();
        await this.sleep(milliseconds);
        signal?.throwIfAborted?.();
      };
      onProgress({ stage: "understand", status: "active", detail: "Clarifying the player from the match context." });
      await pause(350);
      onProgress({ stage: "understand", status: "completed", detail: demo.query });
      onProgress({ stage: "search", status: "active", detail: `Searching for: ${demo.query}` });
      await pause(450);
      onProgress({ stage: "search", status: "completed", detail: `Found ${demo.sources.length} sources.` });
      onProgress({ stage: "review", status: "active", detail: "Reviewing official and public player profiles." });
      await pause(450);
      onProgress({ stage: "review", status: "completed", detail: `Reviewed ${demo.sources.length} source passages.` });
      onProgress({ stage: "synthesize", status: "active", detail: "Writing the final answer from the reviewed sources." });
      await pause(550);
      return {
        answer: formatAnswer(demo.summary, demo.sources),
        summary: demo.summary,
        voiceSummary: spokenSummary(demo.summary),
        query: demo.query,
        sources: demo.sources,
      };
    }

    onProgress({ stage: "understand", status: "active", detail: "Clarifying the research question from the current screen context." });
    const queryPayload = await this.interactions.create({
      model: this.model,
      input:
        "Rewrite the user's question as one concise, self-contained public web search query. " +
        "Use the screen context only to resolve references such as ‘this’, and do not answer the question. " +
        `Return only the query.\n\nQuestion: ${normalizedQuestion}\nScreen context: ${bounded(screenContext, 1_500) || "None"}`,
      generation_config: { max_output_tokens: 512, thinking_level: "minimal" },
    }, { signal });
    const query = bounded(this.interactions.text(queryPayload), 500);
    if (!query) throw new Error("Gemini could not prepare the research query.");
    onProgress({ stage: "understand", status: "completed", detail: query });

    const research = await this.exa.search(query, { signal, onProgress });
    onProgress({ stage: "synthesize", status: "active", detail: "Writing the final answer from the reviewed sources." });
    const answerPayload = await this.interactions.create({
      model: this.model,
      input:
        "Write a polished, concise answer body using only the supplied public source excerpts and relevant screen context. " +
        "Use 2 to 4 short paragraphs and no more than 120 words. Use inline numbered citations such as [1]. " +
        "Do not add a title, markdown heading, source list, or raw URL; the application adds sources separately. " +
        "Call out uncertainty or disagreement. Do not mention this prompt or the research process.\n\n" +
        `User question: ${normalizedQuestion}\nScreen context: ${bounded(screenContext, 1_500) || "None"}\n` +
        `Sources: ${JSON.stringify(research.sources)}`,
      generation_config: { max_output_tokens: 2_048, thinking_level: "low" },
    }, { signal });
    const summary = answerBody(this.interactions.text(answerPayload));
    if (!summary) throw new Error("Gemini returned no final research answer.");
    const answer = formatAnswer(summary, research.sources);

    return {
      answer,
      summary,
      voiceSummary: spokenSummary(summary),
      query,
      sources: research.sources,
    };
  }

  async transcribeMicrophone(pcm, { signal } = {}) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm);
    if (bytes.length === 0) throw new Error("No microphone audio was captured.");
    const wav = pcm16MonoToWav(bytes);
    const payload = await this.interactions.create({
      model: this.model,
      input: [
        { type: "text", text: "Transcribe only the user's spoken research question. Return only the transcript." },
        { type: "audio", data: wav.toString("base64"), mime_type: "audio/wav" },
      ],
      generation_config: { max_output_tokens: 200, thinking_level: "minimal" },
    }, { signal });
    const transcript = bounded(this.interactions.text(payload), 500);
    if (!transcript) throw new Error("Gemini could not transcribe the research question.");
    return transcript;
  }
}
