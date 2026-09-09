#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_velocity;
in vec2 a_tint;
in float a_seed;

out vec3 v_color;

uniform vec2 u_bounds;
uniform float u_pointSize;
uniform vec3 u_baseColor;
uniform float u_intensity;
uniform float u_speedGain;

vec3 hueToRgb(float h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    return clamp(min(k, 4.0 - k), 0.0, 1.0);
}

void main() {
    gl_Position = vec4(a_position / u_bounds, 0.0, 1.0);
    gl_PointSize = u_pointSize;

    float speed = clamp(length(a_velocity) * u_speedGain, 0.0, 1.0);
    float paint = clamp(a_tint.y, 0.0, 1.0);
    vec3 finger = mix(vec3(1.0), hueToRgb(a_tint.x), 0.85);

    vec3 color = mix(u_baseColor, finger, paint);
    float brightness = (0.28 + 0.5 * speed + 0.7 * paint) * (0.75 + 0.5 * a_seed);
    v_color = color * brightness * u_intensity;
}
