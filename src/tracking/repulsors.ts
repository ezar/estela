/**
 * Turns hand landmarks into the flat `vec4` array the step shader reads.
 *
 * Four floats per point: world x, world y, hue and weight. Detection runs at
 * about 30 Hz and rendering at 60, so every slot keeps the last two detections
 * and is interpolated at draw time. Without that the hole in the swarm advances
 * in visible steps even though the field itself is smooth.
 */
import { DEFAULT_ONE_EURO, OneEuroFilter, type OneEuroOptions } from '../filter/oneEuro';
import type { HandSample } from './landmarker';

export const LANDMARKS_PER_HAND = 21;
export const MAX_HANDS = 2;
export const MAX_REPULSORS = LANDMARKS_PER_HAND * MAX_HANDS;

/**
 * Hue per finger, carried over from the original proof of concept: thumb amber,
 * index teal, middle blue, ring violet, little finger rose.
 */
const FINGER_HUES = {
  palm: 0.52,
  thumb: 0.09,
  index: 0.47,
  middle: 0.6,
  ring: 0.78,
  little: 0.93,
} as const;

/** MediaPipe landmark order: 0 wrist, then four points per finger. */
function hueForLandmark(index: number): number {
  if (index === 0) return FINGER_HUES.palm;
  if (index <= 4) return FINGER_HUES.thumb;
  if (index <= 8) return FINGER_HUES.index;
  if (index <= 12) return FINGER_HUES.middle;
  if (index <= 16) return FINGER_HUES.ring;
  return FINGER_HUES.little;
}

const TIPS = new Set([4, 8, 12, 16, 20]);

/** Fingertips push a little harder than knuckles, the wrist a little less. */
function weightForLandmark(index: number): number {
  if (TIPS.has(index)) return 1;
  if (index === 0) return 0.7;
  return 0.85;
}

/** Seconds a slot takes to fade in when a hand appears, and out when it goes. */
const FADE_IN = 0.12;
const FADE_OUT = 0.2;

/** How far past the newest detection the interpolation is allowed to run. */
const MAX_EXTRAPOLATION = 1.25;

interface Slot {
  readonly hue: number;
  readonly baseWeight: number;
  readonly filterX: OneEuroFilter;
  readonly filterY: OneEuroFilter;
  previousX: number;
  previousY: number;
  previousTime: number;
  targetX: number;
  targetY: number;
  targetTime: number;
  present: boolean;
  weight: number;
}

export interface ViewMapping {
  /** Half extents of the world rect: (aspect, 1). */
  bounds: readonly [number, number];
  /** Width over height of the camera frame. */
  videoAspect: number;
}

/**
 * Normalised video coordinates to world coordinates, cover fitted so the frame
 * fills the canvas. The front camera is mirrored, and since it is never drawn
 * the flip has to happen here or the hole appears on the wrong side.
 */
export function toWorld(
  x: number,
  y: number,
  { bounds, videoAspect }: ViewMapping,
): [number, number] {
  const mirrored = 1 - x;
  const planeX = (mirrored - 0.5) * videoAspect;
  const planeY = 0.5 - y;
  const canvasAspect = bounds[0] / bounds[1];
  const scale = Math.max((2 * canvasAspect) / videoAspect, 2) * bounds[1];
  return [planeX * scale, planeY * scale];
}

export class RepulsorField {
  private readonly slots: Slot[] = [];
  private readonly packed = new Float32Array(MAX_REPULSORS * 4);
  private activeCount = 0;

  constructor(filterOptions: OneEuroOptions = DEFAULT_ONE_EURO) {
    for (let hand = 0; hand < MAX_HANDS; hand += 1) {
      for (let index = 0; index < LANDMARKS_PER_HAND; index += 1) {
        this.slots.push({
          hue: hueForLandmark(index),
          baseWeight: weightForLandmark(index),
          filterX: new OneEuroFilter(filterOptions),
          filterY: new OneEuroFilter(filterOptions),
          previousX: 0,
          previousY: 0,
          previousTime: 0,
          targetX: 0,
          targetY: 0,
          targetTime: 0,
          present: false,
          weight: 0,
        });
      }
    }
  }

  /** Feeds one detection. `time` is in seconds. */
  update(hands: HandSample[], time: number, view: ViewMapping) {
    for (let hand = 0; hand < MAX_HANDS; hand += 1) {
      const sample = hands[hand];
      for (let index = 0; index < LANDMARKS_PER_HAND; index += 1) {
        const slot = this.slots[hand * LANDMARKS_PER_HAND + index];
        const point = sample?.points[index];
        if (!point) {
          if (slot.present) {
            slot.present = false;
            slot.filterX.reset();
            slot.filterY.reset();
          }
          continue;
        }

        const [worldX, worldY] = toWorld(point.x, point.y, view);
        const x = slot.filterX.filter(worldX, time);
        const y = slot.filterY.filter(worldY, time);

        if (!slot.present) {
          slot.present = true;
          slot.previousX = x;
          slot.previousY = y;
          slot.previousTime = time - 1 / 30;
        } else {
          slot.previousX = slot.targetX;
          slot.previousY = slot.targetY;
          slot.previousTime = slot.targetTime;
        }
        slot.targetX = x;
        slot.targetY = y;
        slot.targetTime = time;
      }
    }
  }

  /**
   * Interpolates every slot to `time` and packs the active ones. `dt` drives
   * the appear and disappear ramps, so holes fade instead of popping.
   */
  sample(time: number, dt: number): { data: Float32Array; count: number } {
    let cursor = 0;
    for (const slot of this.slots) {
      const target = slot.present ? 1 : 0;
      const rate = dt / (slot.present ? FADE_IN : FADE_OUT);
      slot.weight = approach(slot.weight, target, rate);
      if (slot.weight <= 0.001) continue;

      const span = slot.targetTime - slot.previousTime;
      const alpha =
        span > 1e-4 ? clamp((time - slot.previousTime) / span, 0, MAX_EXTRAPOLATION) : 1;
      const x = slot.previousX + (slot.targetX - slot.previousX) * alpha;
      const y = slot.previousY + (slot.targetY - slot.previousY) * alpha;

      this.packed[cursor * 4] = x;
      this.packed[cursor * 4 + 1] = y;
      this.packed[cursor * 4 + 2] = slot.hue;
      this.packed[cursor * 4 + 3] = slot.baseWeight * slot.weight;
      cursor += 1;
    }
    // Leftovers from a busier frame would otherwise still be uploaded.
    this.packed.fill(0, cursor * 4, this.activeCount * 4);
    this.activeCount = cursor;
    return { data: this.packed, count: cursor };
  }

  /** True while at least one hand is being tracked. */
  get hasHands(): boolean {
    return this.slots.some((slot) => slot.present);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function approach(value: number, target: number, rate: number): number {
  if (value < target) return Math.min(target, value + rate);
  return Math.max(target, value - rate);
}
