/**
 * Shape mode.
 *
 * Every particle owns a rest position and a spring pulling it there, so hands
 * push the shape apart and it reassembles. The rest positions come from
 * rasterising text or an image into a hidden canvas and sampling the pixels
 * above a luminance threshold, which is what lets anyone write a word and break
 * it with their hands.
 */

const RASTER_HEIGHT = 256;
const LUMINANCE_THRESHOLD = 0.35;

export interface ShapeOptions {
  /** Half extents of the world rect: (aspect, 1). */
  bounds: readonly [number, number];
  count: number;
}

type Painter = (context: CanvasRenderingContext2D, width: number, height: number) => void;

/** Rest positions spelling `text`, one pair of world coordinates per particle. */
export function restPositionsFromText(text: string, options: ShapeOptions): Float32Array {
  const trimmed = text.trim();
  if (trimmed.length === 0) return scatter(options);
  return rasterize((context, width, height) => {
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const fontSize = fitFontSize(context, trimmed, width * 0.88, height * 0.62);
    context.font = `600 ${fontSize}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    context.fillText(trimmed, width / 2, height / 2);
  }, options);
}

/** Rest positions tracing the bright pixels of an image. */
export function restPositionsFromImage(
  image: CanvasImageSource,
  options: ShapeOptions,
): Float32Array {
  return rasterize((context, width, height) => {
    const size = imageSize(image);
    const scale = Math.min(width / size.width, height / size.height) * 0.9;
    const w = size.width * scale;
    const h = size.height * scale;
    context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }, options);
}

function rasterize(paint: Painter, options: ShapeOptions): Float32Array {
  const aspect = options.bounds[0] / options.bounds[1];
  const height = RASTER_HEIGHT;
  const width = Math.max(1, Math.round(RASTER_HEIGHT * aspect));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return scatter(options);

  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  paint(context, width, height);

  const { data } = context.getImageData(0, 0, width, height);
  const pixels: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const a = data[i * 4 + 3] / 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
    if (luminance > LUMINANCE_THRESHOLD) pixels.push(i);
  }
  if (pixels.length === 0) return scatter(options);

  shuffle(pixels);

  const { count, bounds } = options;
  const rest = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    // Cycling through a shuffled list keeps the density even; picking at random
    // would leave clots and gaps.
    const pixel = pixels[i % pixels.length];
    const px = (pixel % width) + Math.random();
    const py = Math.floor(pixel / width) + Math.random();
    rest[i * 2] = (px / width - 0.5) * 2 * bounds[0];
    rest[i * 2 + 1] = (0.5 - py / height) * 2 * bounds[1];
  }
  return rest;
}

/** Fallback rest positions: a uniform cloud, used when nothing was drawn. */
function scatter({ count, bounds }: ShapeOptions): Float32Array {
  const rest = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    rest[i * 2] = (Math.random() * 2 - 1) * bounds[0];
    rest[i * 2 + 1] = (Math.random() * 2 - 1) * bounds[1];
  }
  return rest;
}

function fitFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
): number {
  let size = maxHeight;
  for (let i = 0; i < 12; i += 1) {
    context.font = `600 ${size}px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const width = context.measureText(text).width;
    if (width <= maxWidth) break;
    size *= Math.max(0.5, maxWidth / width);
  }
  return Math.max(8, size);
}

function imageSize(image: CanvasImageSource): { width: number; height: number } {
  if (image instanceof HTMLImageElement)
    return { width: image.naturalWidth, height: image.naturalHeight };
  if (image instanceof HTMLVideoElement)
    return { width: image.videoWidth, height: image.videoHeight };
  if (image instanceof HTMLCanvasElement || image instanceof ImageBitmap) {
    return { width: image.width, height: image.height };
  }
  return { width: 1, height: 1 };
}

function shuffle(values: number[]) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = values[i];
    values[i] = values[j];
    values[j] = swap;
  }
}
