/**
 * One Euro filter (Casiez, Roussel and Vogel, 2012).
 *
 * Cuts the jitter of the landmark stream without adding the lag a plain low
 * pass would: the cutoff rises with the speed of the signal, so a still hand is
 * smoothed hard and a moving hand is barely touched.
 */

const TWO_PI = Math.PI * 2;

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

class LowPass {
  private value = 0;
  private initialised = false;

  filter(x: number, a: number): number {
    if (!this.initialised) {
      this.value = x;
      this.initialised = true;
      return x;
    }
    this.value = a * x + (1 - a) * this.value;
    return this.value;
  }

  get last(): number {
    return this.value;
  }

  get ready(): boolean {
    return this.initialised;
  }

  reset() {
    this.initialised = false;
    this.value = 0;
  }
}

export interface OneEuroOptions {
  /** Cutoff at rest, in Hz. Lower is smoother and laggier. */
  minCutoff: number;
  /** How much the cutoff opens up with speed. */
  beta: number;
  /** Cutoff of the derivative estimate, in Hz. */
  derivativeCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroOptions = {
  minCutoff: 1.0,
  beta: 0.03,
  derivativeCutoff: 1.0,
};

export class OneEuroFilter {
  private readonly value = new LowPass();
  private readonly derivative = new LowPass();
  private lastTime: number | null = null;

  constructor(private readonly options: OneEuroOptions = DEFAULT_ONE_EURO) {}

  /** `time` in seconds. */
  filter(x: number, time: number): number {
    const dt = this.lastTime === null ? 1 / 30 : Math.max(time - this.lastTime, 1e-4);
    this.lastTime = time;

    const rate = this.value.ready ? (x - this.value.last) / dt : 0;
    const speed = Math.abs(this.derivative.filter(rate, alpha(this.options.derivativeCutoff, dt)));
    const cutoff = this.options.minCutoff + this.options.beta * speed;
    return this.value.filter(x, alpha(cutoff, dt));
  }

  reset() {
    this.value.reset();
    this.derivative.reset();
    this.lastTime = null;
  }
}
