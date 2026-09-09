#version 300 es
// Never runs: the step pass draws with RASTERIZER_DISCARD enabled and its
// output leaves through transform feedback. GLSL still demands a fragment
// shader to link the program.
precision mediump float;

out vec4 fragColor;

void main() {
    fragColor = vec4(0.0);
}
