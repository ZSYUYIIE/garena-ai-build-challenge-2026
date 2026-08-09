export type ResearchAnswerSource = {
  index: number;
  title: string;
  url: string;
};

export type ParsedResearchAnswer = {
  paragraphs: string[];
  sources: ResearchAnswerSource[];
};

const SOURCE_HEADING = /\n\s*##\s+Sources\s*\n/i;
const SOURCE_LINE = /^(\d+)\.\s+\[([^\]]+)]\((https?:\/\/[^\s]+)\)$/;

export function parseResearchAnswer(text: string): ParsedResearchAnswer {
  const normalized = text.trim();
  const heading = SOURCE_HEADING.exec(normalized);
  const body = heading ? normalized.slice(0, heading.index) : normalized;
  const sourceBlock = heading ? normalized.slice(heading.index + heading[0].length) : "";
  const paragraphs = body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const sources = sourceBlock.split("\n").flatMap((line) => {
    const match = SOURCE_LINE.exec(line.trim());
    if (!match) return [];
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 1) return [];
    return [{ index, title: match[2].trim(), url: match[3] }];
  });
  return { paragraphs, sources };
}
