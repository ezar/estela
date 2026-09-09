/**
 * The translucent quad that produces the trails.
 *
 * Nothing is ever cleared: each frame this paints black at a low alpha over the
 * accumulation buffer, so previous frames decay instead of disappearing. The
 * alpha is the single most sensitive knob in the project. Around 0.02
 * everything smears into soup, around 0.3 there is no trail left.
 */
import quadVertexSource from './quad.vert.glsl?raw';
import fadeFragmentSource from './fade.frag.glsl?raw';
import { createProgram, uniformLocations } from '../gl/utils';

export const DEFAULT_TRAIL_ALPHA = 0.08;

export class FadeQuad {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly alphaLocation: WebGLUniformLocation | undefined;
  private readonly vao: WebGLVertexArrayObject;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, quadVertexSource, fadeFragmentSource, { label: 'fade' });
    this.alphaLocation = uniformLocations(gl, this.program).get('u_alpha');
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    this.vao = vao;
  }

  draw(alpha: number) {
    const { gl } = this;
    gl.useProgram(this.program);
    if (this.alphaLocation) gl.uniform1f(this.alphaLocation, alpha);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteVertexArray(this.vao);
  }
}
