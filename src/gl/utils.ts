/** Minimal WebGL2 helpers. No abstraction beyond what the two programs need. */

export function createContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    // Trails come from accumulating into an offscreen texture, never from
    // preserving the drawing buffer. See docs/DECISIONS.md.
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    throw new Error('WebGL2 is not available on this device.');
  }
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create shader ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`Failed to compile ${label}:\n${log}`);
  }
  return shader;
}

export interface ProgramOptions {
  /** Names of the vertex outputs captured by transform feedback, in buffer order. */
  feedbackVaryings?: string[];
  label?: string;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  options: ProgramOptions = {},
): WebGLProgram {
  const label = options.label ?? 'program';
  const program = gl.createProgram();
  if (!program) throw new Error(`Could not create ${label}`);

  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource, `${label}.vert`);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}.frag`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);

  if (options.feedbackVaryings) {
    gl.transformFeedbackVaryings(program, options.feedbackVaryings, gl.SEPARATE_ATTRIBS);
  }

  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Failed to link ${label}:\n${log}`);
  }
  return program;
}

/** Every active uniform of a program, keyed by name, resolved once at build time. */
export function uniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Map<string, WebGLUniformLocation> {
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  const map = new Map<string, WebGLUniformLocation>();
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    // Array uniforms report as `name[0]`; store them under the bare name too.
    const bare = info.name.replace(/\[0\]$/, '');
    const location = gl.getUniformLocation(program, info.name);
    if (location) map.set(bare, location);
  }
  return map;
}

export function attributeLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Map<string, number> {
  const count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  const map = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveAttrib(program, i);
    if (!info) continue;
    map.set(info.name, gl.getAttribLocation(program, info.name));
  }
  return map;
}

export function createBuffer(
  gl: WebGL2RenderingContext,
  data: ArrayBufferView | number,
  usage: number,
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Could not create buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  if (typeof data === 'number') {
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  } else {
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return buffer;
}
