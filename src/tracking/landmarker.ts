/**
 * MediaPipe HandLandmarker wrapper.
 *
 * Nothing MediaPipe shaped leaves this file: callers receive plain normalised
 * points. That boundary is what lets the detection engine be swapped without
 * touching the simulation.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { fetchAsset } from '../assets/compressed';

/** A hand as a list of 21 points in normalised video space, origin top left. */
export interface HandSample {
  points: { x: number; y: number }[];
}

export interface DetectionResult {
  hands: HandSample[];
  /** Detection time in seconds, on the same clock as `performance.now()`. */
  time: number;
}

/**
 * Absolute URLs for the wasm runtime and the model. The app is served from a
 * subdirectory on GitHub Pages, and MediaPipe concatenates these prefixes with
 * its own file names before fetching, so resolving them here against the
 * document keeps a bare relative path from being read as a site root path.
 */
const asset = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;

const WASM_PATH = asset('wasm');
const MODEL_PATH = asset('models/hand_landmarker.task');
const TARGET_INTERVAL = 1 / 30;

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private stopped = false;
  private lastDetection = 0;
  private lastTimestamp = -1;
  private frameHandle: number | null = null;
  private rafHandle: number | null = null;

  async load(): Promise<void> {
    // The resolver picks the SIMD or the plain build; both arrive compressed,
    // so hand the runtime the bytes rather than a path it would fetch itself.
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const [runtime, model] = await Promise.all([
      fetchAsset(fileset.wasmBinaryPath),
      fetchAsset(MODEL_PATH),
    ]);
    const runtimeUrl = URL.createObjectURL(new Blob([runtime], { type: 'application/wasm' }));

    try {
      this.landmarker = await HandLandmarker.createFromOptions(
        { ...fileset, wasmBinaryPath: runtimeUrl },
        {
          baseOptions: { modelAssetBuffer: model, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        },
      );
    } finally {
      URL.revokeObjectURL(runtimeUrl);
    }
  }

  /** Runs one inference to pay the first frame cost before anything is on screen. */
  warmUp(video: HTMLVideoElement) {
    if (!this.landmarker || video.videoWidth === 0) return;
    try {
      this.landmarker.detectForVideo(video, performance.now());
      this.lastTimestamp = performance.now();
    } catch {
      // A failed warm up is not fatal, the first real frame will retry.
    }
  }

  /**
   * Detection runs at about 30 Hz, decoupled from the 60 Hz simulation. It
   * prefers `requestVideoFrameCallback` so it fires once per decoded camera
   * frame and never twice on the same one.
   */
  start(video: HTMLVideoElement, onResult: (result: DetectionResult) => void) {
    this.stopped = false;

    const detect = () => {
      const landmarker = this.landmarker;
      if (this.stopped || !landmarker || video.videoWidth === 0) return;
      const now = performance.now();
      if (now - this.lastDetection < TARGET_INTERVAL * 1000 - 2) return;
      this.lastDetection = now;

      // MediaPipe rejects a timestamp that does not advance.
      const timestamp = now <= this.lastTimestamp ? this.lastTimestamp + 1 : now;
      this.lastTimestamp = timestamp;

      const result = landmarker.detectForVideo(video, timestamp);
      onResult({
        hands: result.landmarks.map((points) => ({
          points: points.map((p) => ({ x: p.x, y: p.y })),
        })),
        time: now / 1000,
      });
    };

    if ('requestVideoFrameCallback' in video) {
      const loop = () => {
        if (this.stopped) return;
        detect();
        this.frameHandle = video.requestVideoFrameCallback(loop);
      };
      this.frameHandle = video.requestVideoFrameCallback(loop);
    } else {
      const loop = () => {
        if (this.stopped) return;
        detect();
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  stop() {
    this.stopped = true;
    if (this.frameHandle !== null) {
      // No cancel exists on every implementation, the guard above is enough.
      this.frameHandle = null;
    }
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose() {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
  }
}
