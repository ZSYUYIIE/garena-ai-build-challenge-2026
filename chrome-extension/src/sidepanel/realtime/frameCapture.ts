const FRAME_CAPTURE_MAX_WIDTH = 1280;
const FALLBACK_SOURCE_WIDTH = 1280;
const FALLBACK_SOURCE_HEIGHT = 720;

export const FRAME_CAPTURE_JPEG_QUALITY = 0.8;
export const FRAME_CAPTURE_MAX_BYTES = 512 * 1024;

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

/** Encodes a frame within the protocol cap without ever increasing its source dimensions. */
export async function encodeJpegWithinBudget(
  canvas: HTMLCanvasElement,
): Promise<Blob | null> {
  for (const quality of [FRAME_CAPTURE_JPEG_QUALITY, 0.65, 0.5]) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= FRAME_CAPTURE_MAX_BYTES) return blob;
  }

  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  if (sourceWidth < 2 || sourceHeight < 2) return null;
  const reduced = document.createElement("canvas");
  reduced.width = Math.max(1, Math.floor(sourceWidth * 0.75));
  reduced.height = Math.max(1, Math.floor(sourceHeight * 0.75));
  const context = reduced.getContext("2d", { alpha: false });
  if (!context) return null;
  context.drawImage(canvas, 0, 0, reduced.width, reduced.height);
  for (const quality of [0.65, 0.5]) {
    const blob = await canvasToBlob(reduced, quality);
    if (blob && blob.size <= FRAME_CAPTURE_MAX_BYTES) return blob;
  }
  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
