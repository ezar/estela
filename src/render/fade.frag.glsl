#version 300 es
// The trail knob. Drawn over the accumulation buffer with regular alpha
// blending, so every frame the previous ones lose u_alpha of their light.
precision mediump float;

uniform float u_alpha;
out vec4 fragColor;

void main() {
    fragColor = vec4(0.0, 0.0, 0.0, u_alpha);
}
