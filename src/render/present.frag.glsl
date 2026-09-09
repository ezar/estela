#version 300 es
precision mediump float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_accumulation;
uniform float u_exposure;

void main() {
    vec3 c = texture(u_accumulation, v_uv).rgb;
    // Exponential tonemap: piles of additive points glow towards white instead
    // of clipping into flat blocks of colour.
    c = 1.0 - exp(-c * u_exposure);
    fragColor = vec4(c, 1.0);
}
