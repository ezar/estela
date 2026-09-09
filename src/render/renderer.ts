/**
 * Draws the field.
 *
 * Particles are additively blended points accumulated into an offscreen texture
 * that is never cleared, only faded. That texture is then presented to the
 * canvas through a tonemap. Accumulating offscreen rather than relying on the
 * default framebuffer keeps `preserveDrawingBuffer` false while still giving
 * deterministic trails on every browser.
 */
import drawVertexSource from './draw.vert.glsl?raw';
import drawFragmentSource from './draw.frag.glsl?raw';
import quadVertexSource from './quad.vert.glsl?raw';
import presentFragmentSource from './present.frag.glsl?raw';
import { attributeLocations, createProgram, uniformLocations } from '../gl/utils';
import { ParticleBuffers } from '../sim/buffers';
import { FadeQuad, DEFAULT_TRAIL_ALPHA } from './fade';

export interface RenderSettings {
  trailAlpha: number;
  pointSize: number;
  intensity: number;
  exposure: number;
  speedGain: number;
  /** Colour of an untouched particle, linear RGB. */
  baseColor: [number, number, number];
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  trailAlpha: DEFAULT_TRAIL_ALPHA,
  pointSize: 1.5,
  intensity: 0.85,
  exposure: 1.35,
  speedGain: 1.6,
  baseColor: [0.42, 0.66, 0.78],
};

export class Renderer {
  readonly settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS };
  readonly attributes: {
    a_position: number;
    a_velocity: number;
    a_tint: number;
    a_seed: number;
  };

  private readonly gl: WebGL2RenderingContext;
  private readonly drawProgram: WebGLProgram;
  private readonly drawUniforms: Map<string, WebGLUniformLocation>;
  private readonly presentProgram: WebGLProgram;
  private readonly presentUniforms: Map<string, WebGLUniformLocation>;
  private readonly fade: FadeQuad;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly internalFormat: number;
  private readonly texType: number;

  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private width = 0;
  private height = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;

    // Half float keeps the trail decaying all the way to black. On 8 bit
    // targets the last few units never round down and leave a faint haze.
    const float =
      gl.getExtension('EXT_color_buffer_half_float') ?? gl.getExtension('EXT_color_buffer_float');
    this.internalFormat = float ? gl.RGBA16F : gl.RGBA8;
    this.texType = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

    this.drawProgram = createProgram(gl, drawVertexSource, drawFragmentSource, { label: 'draw' });
    this.drawUniforms = uniformLocations(gl, this.drawProgram);
    const attributes = attributeLocations(gl, this.drawProgram);
    this.attributes = {
      a_position: attributes.get('a_position') ?? -1,
      a_velocity: attributes.get('a_velocity') ?? -1,
      a_tint: attributes.get('a_tint') ?? -1,
      a_seed: attributes.get('a_seed') ?? -1,
    };

    this.presentProgram = createProgram(gl, quadVertexSource, presentFragmentSource, {
      label: 'present',
    });
    this.presentUniforms = uniformLocations(gl, this.presentProgram);
    this.fade = new FadeQuad(gl);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    this.emptyVao = vao;
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    const { gl } = this;
    this.width = width;
    this.height = height;

    if (this.texture) gl.deleteTexture(this.texture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Could not create accumulation target');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this.internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      this.texType,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.texture = texture;
    this.framebuffer = framebuffer;
  }

  draw(buffers: ParticleBuffers, bounds: readonly [number, number], pixelRatio: number) {
    const { gl, settings } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);

    this.fade.draw(settings.trailAlpha);

    gl.useProgram(this.drawProgram);
    const boundsLocation = this.drawUniforms.get('u_bounds');
    if (boundsLocation) gl.uniform2f(boundsLocation, bounds[0], bounds[1]);
    setFloat(gl, this.drawUniforms, 'u_pointSize', settings.pointSize * pixelRatio);
    setFloat(gl, this.drawUniforms, 'u_intensity', settings.intensity);
    setFloat(gl, this.drawUniforms, 'u_speedGain', settings.speedGain);
    const colorLocation = this.drawUniforms.get('u_baseColor');
    if (colorLocation) gl.uniform3fv(colorLocation, settings.baseColor);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(buffers.renderVao);
    gl.drawArrays(gl.POINTS, 0, buffers.count);
    gl.bindVertexArray(null);

    // Present.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.presentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const sampler = this.presentUniforms.get('u_accumulation');
    if (sampler) gl.uniform1i(sampler, 0);
    setFloat(gl, this.presentUniforms, 'u_exposure', settings.exposure);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this;
    gl.deleteProgram(this.drawProgram);
    gl.deleteProgram(this.presentProgram);
    gl.deleteVertexArray(this.emptyVao);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    this.fade.dispose();
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
