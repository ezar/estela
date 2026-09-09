/** The integration pass: one drawArrays with transform feedback, no textures. */
import stepVertexSource from './step.vert.glsl?raw';
import stepFragmentSource from './step.frag.glsl?raw';
import { attributeLocations, createProgram, uniformLocations } from '../gl/utils';
import { ParticleBuffers } from './buffers';
import { MAX_REPULSORS } from '../tracking/repulsors';
import { FLOW_PRESET } from '../modes/flow';

export type Mode = 'flow' | 'shape';

export interface SimulationSettings {
  /** Repulsion radius, as a fraction of half the world height. */
  radius: number;
  strength: number;
  drag: number;
  maxSpeed: number;
  tintDecay: number;
  flowScale: number;
  flowSpeed: number;
  flowForce: number;
  spring: number;
  /** Fraction of the flow field that survives in shape mode. */
  shimmer: number;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  radius: 1 / 6,
  strength: 9.5,
  // Per 60 Hz frame. Low inertia keeps the field even, and it is what the
  // strength and spring numbers below are balanced against.
  drag: 0.87,
  maxSpeed: 6,
  tintDecay: 0.4,
  ...FLOW_PRESET,
  // Roughly critical damping against the drag above: the shape reassembles in
  // about a second without wobbling.
  spring: 20,
  shimmer: 0.14,
};

export class Simulation {
  readonly settings: SimulationSettings = { ...DEFAULT_SETTINGS };

  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Map<string, WebGLUniformLocation>;
  readonly attributes: {
    a_position: number;
    a_velocity: number;
    a_tint: number;
    a_rest: number;
    a_seed: number;
  };

  private elapsed = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, stepVertexSource, stepFragmentSource, {
      feedbackVaryings: ['v_position', 'v_velocity', 'v_tint'],
      label: 'step',
    });
    this.uniforms = uniformLocations(gl, this.program);
    const attributes = attributeLocations(gl, this.program);
    this.attributes = {
      a_position: attributes.get('a_position') ?? -1,
      a_velocity: attributes.get('a_velocity') ?? -1,
      a_tint: attributes.get('a_tint') ?? -1,
      a_rest: attributes.get('a_rest') ?? -1,
      a_seed: attributes.get('a_seed') ?? -1,
    };
  }

  /**
   * Advances the field by `dt` seconds.
   *
   * `repulsors` is the packed uniform array: four floats per point, world x and
   * y, hue and weight.
   */
  step(
    buffers: ParticleBuffers,
    dt: number,
    bounds: readonly [number, number],
    mode: Mode,
    repulsors: Float32Array,
    repulsorCount: number,
  ) {
    const { gl, uniforms, settings } = this;
    this.elapsed += dt;

    gl.useProgram(this.program);
    setFloat(gl, uniforms, 'u_dt', dt);
    setFloat(gl, uniforms, 'u_time', this.elapsed);
    setFloat(gl, uniforms, 'u_radius', settings.radius * bounds[1]);
    setFloat(gl, uniforms, 'u_strength', settings.strength);
    setFloat(gl, uniforms, 'u_drag', settings.drag);
    setFloat(gl, uniforms, 'u_maxSpeed', settings.maxSpeed);
    setFloat(gl, uniforms, 'u_tintDecay', settings.tintDecay);
    setFloat(gl, uniforms, 'u_shape', mode === 'shape' ? 1 : 0);
    setFloat(gl, uniforms, 'u_flowScale', settings.flowScale);
    setFloat(gl, uniforms, 'u_flowSpeed', settings.flowSpeed);
    setFloat(gl, uniforms, 'u_flowForce', settings.flowForce);
    setFloat(gl, uniforms, 'u_spring', settings.spring);
    setFloat(gl, uniforms, 'u_shimmer', settings.shimmer);

    const boundsLocation = uniforms.get('u_bounds');
    if (boundsLocation) gl.uniform2f(boundsLocation, bounds[0], bounds[1]);

    const countLocation = uniforms.get('u_repulsorCount');
    if (countLocation) gl.uniform1i(countLocation, Math.min(repulsorCount, MAX_REPULSORS));

    const repulsorLocation = uniforms.get('u_repulsors');
    if (repulsorLocation) gl.uniform4fv(repulsorLocation, repulsors);

    gl.bindVertexArray(buffers.readVao);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, buffers.writeFeedback);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, buffers.count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);

    buffers.swap();
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

function setFloat(
  gl: WebGL2RenderingContext,
  uniforms: Map<string, WebGLUniformLocation>,
  name: string,
  value: number,
) {
  const location = uniforms.get(name);
  if (location) gl.uniform1f(location, value);
}
