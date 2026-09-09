#version 300 es
// Integration pass. Runs with RASTERIZER_DISCARD on; every output below is
// captured by transform feedback into the back buffers.
precision highp float;

const int MAX_REPULSORS = 42;

in vec2 a_position;
in vec2 a_velocity;
in vec2 a_tint; // x: hue 0..1, y: how much of that hue is left, 0..1
in vec2 a_rest;
in float a_seed;

out vec2 v_position;
out vec2 v_velocity;
out vec2 v_tint;

uniform float u_dt;
uniform float u_time;
uniform vec2 u_bounds; // half extents of the world rect: (aspect, 1.0)

// xy: world position, z: hue, w: weight (0 while fading in or out)
uniform vec4 u_repulsors[MAX_REPULSORS];
uniform int u_repulsorCount;
uniform float u_radius;
uniform float u_strength;

uniform float u_drag; // per 1/60 s
uniform float u_maxSpeed;
uniform float u_tintDecay;

uniform float u_shape; // 0.0 flow, 1.0 shape
uniform float u_flowScale;
uniform float u_flowSpeed;
uniform float u_flowForce;
uniform float u_spring;
uniform float u_shimmer; // how much of the flow field survives in shape mode

// -- Simplex noise, Ashima Arts / Stefan Gustavson, MIT licensed -------------

vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}
float mod289(float x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
}
vec4 permute(vec4 x) {
    return mod289(((x * 34.0) + 1.0) * x);
}
float permute(float x) {
    return mod289(((x * 34.0) + 1.0) * x);
}
vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}
float taylorInvSqrt(float r) {
    return 1.79284291400159 - 0.85373472095314 * r;
}

vec4 grad4(float j, vec4 ip) {
    const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
    vec4 p, s;
    p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
    p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
    s = vec4(lessThan(p, vec4(0.0)));
    p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
    return p;
}

float snoise(vec4 v) {
    const vec4 C = vec4(0.138196601125011,  // (5 - sqrt(5)) / 20
                        0.276393202250021,  // 2 * G4
                        0.414589803375032,  // 3 * G4
                        -0.447213595499958  // -1 + 4 * G4
    );
    const float F4 = 0.309016994374947451;

    vec4 i = floor(v + dot(v, vec4(F4)));
    vec4 x0 = v - i + dot(i, C.xxxx);

    vec4 i0;
    vec3 isX = step(x0.yzw, x0.xxx);
    vec3 isYZ = step(x0.zww, x0.yyz);
    i0.x = isX.x + isX.y + isX.z;
    i0.yzw = 1.0 - isX;
    i0.y += isYZ.x + isYZ.y;
    i0.zw += 1.0 - isYZ.xy;
    i0.z += isYZ.z;
    i0.w += 1.0 - isYZ.z;

    vec4 i3 = clamp(i0, 0.0, 1.0);
    vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
    vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);

    vec4 x1 = x0 - i1 + C.xxxx;
    vec4 x2 = x0 - i2 + C.yyyy;
    vec4 x3 = x0 - i3 + C.zzzz;
    vec4 x4 = x0 + C.wwww;

    i = mod289(i);
    float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
    vec4 j1 = permute(permute(permute(permute(i.w + vec4(i1.w, i2.w, i3.w, 1.0)) + i.z +
                                      vec4(i1.z, i2.z, i3.z, 1.0)) +
                              i.y + vec4(i1.y, i2.y, i3.y, 1.0)) +
                      i.x + vec4(i1.x, i2.x, i3.x, 1.0));

    const vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);

    vec4 p0 = grad4(j0, ip);
    vec4 p1 = grad4(j1.x, ip);
    vec4 p2 = grad4(j1.y, ip);
    vec4 p3 = grad4(j1.z, ip);
    vec4 p4 = grad4(j1.w, ip);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    p4 *= taylorInvSqrt(dot(p4, p4));

    vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
    m0 = m0 * m0;
    m1 = m1 * m1;
    return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2))) +
                   dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}

const float PI = 3.14159265359;

/**
 * The world wraps, so the noise has to wrap with it. The plane is embedded in
 * 4D as a torus, one circle per axis, with the radii chosen so arc length on
 * the torus matches distance in the world. Sampling 4D noise there gives a
 * field that is exactly periodic across both seams. Without that the field is
 * discontinuous where particles wrap, they bounce back and forth across the
 * edge, and the swarm slowly drains into a bright rim.
 */
vec4 torus(vec2 p, float t) {
    vec2 angle = (p / u_bounds) * PI;
    vec2 radius = u_bounds * u_flowScale / PI;
    return vec4(radius.x * cos(angle.x), radius.x * sin(angle.x), radius.y * cos(angle.y),
                radius.y * sin(angle.y) + t);
}

float potential(vec2 p, float t) {
    return snoise(torus(p, t));
}

// Curl of a scalar potential: divergence free by construction, which is what
// keeps the field from clumping or opening bald patches.
vec2 curl(vec2 p, float t) {
    const float e = 0.04;
    float dy = potential(p + vec2(0.0, e), t) - potential(p - vec2(0.0, e), t);
    float dx = potential(p + vec2(e, 0.0), t) - potential(p - vec2(e, 0.0), t);
    return vec2(dy, -dx) / (2.0 * e);
}

void main() {
    vec2 pos = a_position;
    vec2 vel = a_velocity;
    vec2 tint = a_tint;

    // 1. Hand repulsion.
    float best = 0.0;
    float bestHue = tint.x;
    for (int i = 0; i < MAX_REPULSORS; i++) {
        if (i >= u_repulsorCount) {
            break;
        }
        vec4 r = u_repulsors[i];
        vec2 delta = pos - r.xy;
        float d = length(delta);
        if (d < u_radius) {
            // Inverted quadratic: saturates at the rim on its own, so no clamp
            // and no particles shot out of frame when one passes near a centre.
            float f = 1.0 - d / u_radius;
            f = f * f * r.w;
            vec2 dir = d > 1e-4 ? delta / d
                                : vec2(cos(a_seed * 6.2831853), sin(a_seed * 6.2831853));
            vel += dir * f * u_strength * u_dt;
            if (f > best) {
                best = f;
                bestHue = r.z;
            }
        }
    }

    // 2. Mode force. The flow never switches off entirely: a trace of it left
    // in shape mode keeps the word breathing instead of freezing into a solid
    // block of pixels.
    vec2 field = curl(pos, u_time * u_flowSpeed);
    vel += field * u_flowForce * mix(1.0, u_shimmer, u_shape) * u_dt;
    if (u_shape > 0.5) {
        vel += (a_rest - pos) * u_spring * u_dt;
    }

    // 3. Drag, expressed per 60 Hz frame so it is frame rate independent.
    vel *= pow(u_drag, u_dt * 60.0);

    float speed = length(vel);
    if (speed > u_maxSpeed) {
        vel *= u_maxSpeed / speed;
    }

    pos += vel * u_dt;

    // Flow wraps around the edges, shape does not: the spring brings them home.
    if (u_shape < 0.5) {
        vec2 span = u_bounds * 2.0;
        pos -= span * floor((pos + u_bounds) / span);
    }

    // Colour: the strongest finger of the frame wins and its hue decays back.
    float gained = clamp(best * 2.2, 0.0, 1.0);
    if (gained >= tint.y) {
        tint.x = bestHue;
        tint.y = gained;
    }
    tint.y *= exp(-u_tintDecay * u_dt);

    v_position = pos;
    v_velocity = vel;
    v_tint = tint;
}
