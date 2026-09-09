/**
 * Flow mode.
 *
 * A curl noise field drags the particles into currents and there is no rest
 * position: whatever leaves one edge comes back on the opposite one. The curl
 * of a scalar potential is divergence free, so the field never clumps and never
 * opens bald patches the way plain noise does. The field itself is evaluated in
 * `sim/step.vert.glsl`; what lives here are the numbers that shape it.
 */
import type { SimulationSettings } from '../sim/simulation';

export const FLOW_PRESET: Pick<SimulationSettings, 'flowScale' | 'flowSpeed' | 'flowForce'> = {
  /** World units per noise cell. Higher means smaller, busier swirls. */
  flowScale: 1.4,
  /**
   * How fast the field itself evolves. A nearly static field lets particles
   * settle onto its attractors and the swarm slowly tears into filaments with
   * large voids, which is exactly what curl noise is supposed to avoid. Keeping
   * the field moving redistributes them.
   */
  flowSpeed: 0.4,
  /** Acceleration towards the local current. */
  flowForce: 0.95,
};
