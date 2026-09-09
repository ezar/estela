/**
 * Double buffered particle state for transform feedback.
 *
 * Per particle the simulation carries position, velocity and tint, all three
 * written every step, so they live in two alternating sets of buffers. Seed and
 * rest position never change during a step and are shared by both sets.
 */
import { createBuffer } from '../gl/utils';

export interface ParticleAttributeLocations {
  a_position: number;
  a_velocity: number;
  a_tint: number;
  a_rest: number;
  a_seed: number;
}

interface StateSet {
  position: WebGLBuffer;
  velocity: WebGLBuffer;
  tint: WebGLBuffer;
}

/** Base hue the field settles back to, in the 0..1 hue circle. */
export const REST_HUE = 0.52;

export class ParticleBuffers {
  readonly count: number;

  private readonly gl: WebGL2RenderingContext;
  private readonly sets: [StateSet, StateSet];
  private readonly seed: WebGLBuffer;
  private readonly rest: WebGLBuffer;
  private readonly stepVaos: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly drawVaos: [WebGLVertexArrayObject, WebGLVertexArrayObject];
  private readonly feedbacks: [WebGLTransformFeedback, WebGLTransformFeedback];
  private front = 0;

  constructor(
    gl: WebGL2RenderingContext,
    count: number,
    bounds: readonly [number, number],
    stepAttributes: ParticleAttributeLocations,
    drawAttributes: Omit<ParticleAttributeLocations, 'a_rest'>,
  ) {
    this.gl = gl;
    this.count = count;

    const positions = new Float32Array(count * 2);
    const tints = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      // Uniform distribution and zero velocity: a random starting velocity
      // gives an ugly explosion in the first second.
      positions[i * 2] = (Math.random() * 2 - 1) * bounds[0];
      positions[i * 2 + 1] = (Math.random() * 2 - 1) * bounds[1];
      tints[i * 2] = REST_HUE;
      tints[i * 2 + 1] = 0;
      seeds[i] = Math.random();
    }
    const velocities = new Float32Array(count * 2);

    const stream = gl.DYNAMIC_COPY;
    this.sets = [
      {
        position: createBuffer(gl, positions, stream),
        velocity: createBuffer(gl, velocities, stream),
        tint: createBuffer(gl, tints, stream),
      },
      {
        position: createBuffer(gl, positions.byteLength, stream),
        velocity: createBuffer(gl, velocities.byteLength, stream),
        tint: createBuffer(gl, tints.byteLength, stream),
      },
    ];
    this.seed = createBuffer(gl, seeds, gl.STATIC_DRAW);
    this.rest = createBuffer(gl, positions, gl.STATIC_DRAW);

    this.stepVaos = [this.createStepVao(0, stepAttributes), this.createStepVao(1, stepAttributes)];
    this.drawVaos = [this.createDrawVao(0, drawAttributes), this.createDrawVao(1, drawAttributes)];
    this.feedbacks = [this.createFeedback(1), this.createFeedback(0)];
  }

  /** VAO reading state set `index`, plus the shared static attributes. */
  private createStepVao(index: number, attributes: ParticleAttributeLocations) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    const set = this.sets[index];
    gl.bindVertexArray(vao);
    bindAttribute(gl, set.position, attributes.a_position, 2);
    bindAttribute(gl, set.velocity, attributes.a_velocity, 2);
    bindAttribute(gl, set.tint, attributes.a_tint, 2);
    bindAttribute(gl, this.rest, attributes.a_rest, 2);
    bindAttribute(gl, this.seed, attributes.a_seed, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  private createDrawVao(index: number, attributes: Omit<ParticleAttributeLocations, 'a_rest'>) {
    const { gl } = this;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    const set = this.sets[index];
    gl.bindVertexArray(vao);
    bindAttribute(gl, set.position, attributes.a_position, 2);
    bindAttribute(gl, set.velocity, attributes.a_velocity, 2);
    bindAttribute(gl, set.tint, attributes.a_tint, 2);
    bindAttribute(gl, this.seed, attributes.a_seed, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Transform feedback object writing into state set `index`. */
  private createFeedback(index: number) {
    const { gl } = this;
    const feedback = gl.createTransformFeedback();
    if (!feedback) throw new Error('Could not create transform feedback');
    const set = this.sets[index];
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, set.position);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, set.velocity);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, set.tint);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    return feedback;
  }

  get readVao(): WebGLVertexArrayObject {
    return this.stepVaos[this.front];
  }

  get writeFeedback(): WebGLTransformFeedback {
    return this.feedbacks[this.front];
  }

  get renderVao(): WebGLVertexArrayObject {
    return this.drawVaos[this.front];
  }

  swap() {
    this.front = 1 - this.front;
  }

  /** Replaces the rest positions used by shape mode. */
  setRestPositions(positions: Float32Array) {
    const { gl } = this;
    if (positions.length !== this.count * 2) {
      throw new Error(`Expected ${this.count * 2} rest components, got ${positions.length}`);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rest);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  dispose() {
    const { gl } = this;
    for (const set of this.sets) {
      gl.deleteBuffer(set.position);
      gl.deleteBuffer(set.velocity);
      gl.deleteBuffer(set.tint);
    }
    gl.deleteBuffer(this.seed);
    gl.deleteBuffer(this.rest);
    for (const vao of [...this.stepVaos, ...this.drawVaos]) gl.deleteVertexArray(vao);
    for (const feedback of this.feedbacks) gl.deleteTransformFeedback(feedback);
  }
}

function bindAttribute(
  gl: WebGL2RenderingContext,
  buffer: WebGLBuffer,
  location: number,
  size: number,
) {
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}
