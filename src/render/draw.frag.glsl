#version 300 es
precision mediump float;

in vec3 v_color;
out vec4 fragColor;

void main() {
    // Additive blending: alpha is carried so the accumulation buffer keeps a
    // sensible coverage channel for the fade quad to eat into.
    fragColor = vec4(v_color, 1.0);
}
