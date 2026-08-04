const FRAME_CAPTURE_MAX_WIDTH = 1280;
const FALLBACK_SOURCE_WIDTH = 1280;
const FALLBACK_SOURCE_HEIGHT = 720;

export const FRAME_CAPTURE_JPEG_QUALITY = 0.8;

export function calculateFrameDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const safeWidth =
    Number.isFinite(sourceWidth) && sourceWidth > 0
      ? sourceWidth
      : FALLBACK_SOURCE_WIDTH;
  const safeHeight =
    Number.isFinite(sourceHeight) && sourceHeight > 0
      ? sourceHeight
      : FALLBACK_SOURCE_HEIGHT;
  const width = Math.min(FRAME_CAPTURE_MAX_WIDTH, Math.round(safeWidth));
  const height = Math.max(1, Math.round(width * (safeHeight / safeWidth)));

  return { width, height };
}
