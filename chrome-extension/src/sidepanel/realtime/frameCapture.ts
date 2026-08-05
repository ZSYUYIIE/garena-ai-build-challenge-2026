const FRAME_CAPTURE_MAX_WIDTH = 1280;
const FALLBACK_SOURCE_WIDTH = 1280;
const FALLBACK_SOURCE_HEIGHT = 720;
const FRAME_SIGNATURE_COLUMNS = 96;
const CHANGED_CELL_DIFFERENCE = 18;
const CHANGED_CELL_RATIO = 0.008;
const MEAN_DIFFERENCE = 4;
const LOCAL_CELL_DIFFERENCE = 24;

export const FRAME_CAPTURE_JPEG_QUALITY = 0.8;
export const FRAME_CAPTURE_MAX_BYTES = 512 * 1024;

export type FrameSignature = {
  columns: number;
  rows: number;
  luminance: Uint8Array;
};

export function createFrameSignature(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): FrameSignature {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("Frame signature dimensions must be positive integers.");
  }
  if (pixels.length !== width * height * 4) {
    throw new TypeError("Frame signature pixels do not match its dimensions.");
  }

  const columns = FRAME_SIGNATURE_COLUMNS;
  const rows = Math.max(1, Math.round(columns * (height / width)));
  const luminance = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const yStart = Math.floor(row * height / rows);
    const yEnd = Math.max(yStart + 1, Math.floor((row + 1) * height / rows));
    for (let column = 0; column < columns; column += 1) {
      const xStart = Math.floor(column * width / columns);
      const xEnd = Math.max(xStart + 1, Math.floor((column + 1) * width / columns));
      let total = 0;
      let samples = 0;
      for (let y = yStart; y < Math.min(height, yEnd); y += 1) {
        for (let x = xStart; x < Math.min(width, xEnd); x += 1) {
          const index = (y * width + x) * 4;
          total += pixels[index] * 0.2126
            + pixels[index + 1] * 0.7152
            + pixels[index + 2] * 0.0722;
          samples += 1;
        }
      }
      luminance[row * columns + column] = Math.round(total / Math.max(1, samples));
    }
  }
  return { columns, rows, luminance };
}

export function hasMeaningfulVisualChange(
  previous: FrameSignature | null,
  current: FrameSignature,
): boolean {
  if (
    !previous
    || previous.columns !== current.columns
    || previous.rows !== current.rows
    || previous.luminance.length !== current.luminance.length
  ) return true;

  let changedCells = 0;
  let totalDifference = 0;
  let localizedChange = false;
  for (let index = 0; index < current.luminance.length; index += 1) {
    const difference = Math.abs(current.luminance[index] - previous.luminance[index]);
    totalDifference += difference;
    if (difference >= CHANGED_CELL_DIFFERENCE) changedCells += 1;
    if (difference < LOCAL_CELL_DIFFERENCE) continue;

    const column = index % current.columns;
    const right = column + 1 < current.columns ? index + 1 : -1;
    const below = index + current.columns < current.luminance.length
      ? index + current.columns
      : -1;
    if (
      (right >= 0 && Math.abs(current.luminance[right] - previous.luminance[right]) >= LOCAL_CELL_DIFFERENCE)
      || (below >= 0 && Math.abs(current.luminance[below] - previous.luminance[below]) >= LOCAL_CELL_DIFFERENCE)
    ) localizedChange = true;
  }

  return localizedChange
    || changedCells / current.luminance.length >= CHANGED_CELL_RATIO
    || totalDifference / current.luminance.length >= MEAN_DIFFERENCE;
}

export function commitRetainedFrame<T>(
  signature: FrameSignature,
  retain: () => T,
): { signature: FrameSignature; result: T } {
  const result = retain();
  return { signature, result };
}

export function createFrameCaptureScheduler(
  runCapture: (options: { force: boolean }) => Promise<void>,
): { capture: (options: { force: boolean }) => Promise<void> } {
  let inFlight: Promise<void> | null = null;
  let forcePending = false;

  const capture = (options: { force: boolean }): Promise<void> => {
    if (options.force) forcePending = true;
    if (inFlight) return inFlight;

    const initialForce = forcePending;
    forcePending = false;
    const task = (async () => {
      let force = initialForce;
      do {
        await runCapture({ force });
        force = forcePending;
        forcePending = false;
      } while (force);
    })().finally(() => {
      if (inFlight === task) inFlight = null;
    });
    inFlight = task;
    return task;
  };

  return { capture };
}

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
