# enjambre

A field of one hundred thousand particles that reacts to your hands through the webcam. No instructions, no goal, no score. Open it, move your hand, that is the whole thing.

---

## 0. Conventions

**All code and documentation in this repository is written in English.** That covers source files, identifiers, comments, commit messages, this specification, the README, issues and pull requests. No mixed-language identifiers, no Spanish comments in English code.

The only exception is the project name itself, `enjambre`, which is a proper noun.

Other conventions:

- TypeScript in strict mode. No `any` outside of typed third-party boundaries.
- Conventional Commits for commit messages.
- Prettier and ESLint enforced on commit.
- GLSL shaders live in their own `.glsl` files, imported as strings. Never inlined as template literals in TypeScript.

---

## 1. The decision that defines the project

**The camera feed is never drawn.** Black background, particles only.

This is counterintuitive and it is what makes the project work. With your face behind it, the result is a tech demo. Without it, the result is an image. The hand is inferred from the hole it opens in the swarm, and that hole is more elegant than any skeleton overlay.

It also solves the sharing problem. Nobody posts a video with their face and their living room in the background. With no video feed, there is nothing personal on screen, and the barrier to hitting share drops to zero.

The camera stays on and keeps being processed. It is simply never painted.

---

## 2. Scope

### In scope

- One hundred thousand particles at 60 fps on desktop, fifty thousand on mobile.
- Two hands, 42 active repulsion points.
- Two behaviour modes: free flow and return to shape.
- Trails through accumulation.
- Colour inherited from the finger that pushed each particle.
- Ten-second recording and native share.

### Out of scope

- True 3D simulation with real depth.
- Particle to particle collisions.
- Any UI on top of the field that is not strictly necessary.
- WebXR and augmented reality. Explicitly ruled out: iOS Safari has no WebXR at all, and on Android phones an `immersive-ar` session gives you no hand tracking and consumes the camera, so you can have AR or hands but never both.

---

## 3. Stack

- **Vite** with **TypeScript**, strict.
- **Raw WebGL2**, no three.js. Here three.js would be six hundred kilobytes to use neither the scene graph, nor the cameras, nor the materials. The whole simulation fits in two shaders.
- **@mediapipe/tasks-vision**, with the model served locally.
- **Vercel**, static output.

### Transform feedback, not texture ping-pong

WebGL2 can write vertex shader output straight into a buffer. With that, stepping the particles is a single `drawArrays` with no textures and no CPU readback.

The classic alternative, encoding positions into a texture and alternating between two framebuffers, is what you had to do in WebGL1 and it still shows up in most tutorials. It is more code, more memory and slower. Do not use it.

If WebGL2 is unavailable, show a message and stop. It has shipped on effectively every device since iOS 15. Maintaining a fallback path is not worth it for a hobby project.

---

## 4. Architecture

```
src/
  main.ts
  camera/stream.ts
  tracking/
    landmarker.ts         HandLandmarker wrapper
    repulsors.ts          21 points per hand into a flat uniform array
  filter/oneEuro.ts
  sim/
    buffers.ts            double-buffered position and velocity
    step.vert.glsl        integration and forces
    step.frag.glsl        empty, output goes through transform feedback
  render/
    draw.vert.glsl
    draw.frag.glsl
    fade.ts               translucent quad for trails
  modes/
    flow.ts               curl noise field
    shape.ts              rest positions from text or image
  capture/
    recorder.ts           MediaRecorder and Web Share
  ui/hud.ts
public/models/, public/wasm/
```

Keep `tracking/` behind a narrow interface that exposes nothing but a list of 2D repulsors. That boundary is what lets the detection engine be swapped without touching the simulation, and it costs nothing to put in place on day one.

---

## 5. The simulation

Each particle holds a position, a velocity and a fixed random seed, in two buffers that alternate.

Forces per frame:

1. **Hand repulsion.** Iterate the up to 42 points. For each one, if the distance is below the radius, apply a radial force outwards.
2. **Mode force.** Curl noise in flow mode, a spring towards the rest position in shape mode.
3. **Drag.** Multiply velocity by roughly 0.94.

The detail that decides whether this looks good or bad is the falloff:

```glsl
float d = distance(pos, repulsor);
if (d < R) {
    float f = 1.0 - d / R;
    f = f * f;                    // smooth falloff, not inverse square
    vel += normalize(pos - repulsor) * f * STRENGTH * dt;
}
```

A real inverse square law blows up when a particle passes near the centre and you get projectiles flying off screen. The inverted quadratic falloff saturates on its own at the edge and needs no artificial clamp.

Starting radius: one twelfth of the canvas height. Strength: tune until a hand opens a clean hole without launching particles out of frame.

The 42 repulsors go in as `uniform vec2 repulsors[42]` plus a count. That is far below the uniform limit of any GPU.

---

## 6. Modes

### Flow

A curl noise field drags particles into currents. No rest position: particles leaving one edge reappear on the opposite one. This is the hypnotic mode, the one you watch without doing anything.

Curl noise produces divergence-free swirls, so particles never clump or leave empty patches. Plain noise produces ugly clots.

### Shape

Each particle owns a rest position and a spring pulling it there. Hands push particles away and they return.

Rest positions come from rasterising text or an image into a hidden canvas, reading the pixels and sampling those above a luminance threshold. That lets you write a word and break it apart with your hands, which is what people will actually record.

Expose a text field in the UI. It is the feature that makes every recording different.

---

## 7. Rendering

- One to two pixel points, fixed `gl_PointSize`.
- Additive blending. Where particles pile up, it glows. That is what produces light rather than confetti.
- **Trails through accumulation.** Never clear the canvas. Each frame, draw a black quad at alpha 0.08 on top. Previous frames decay and particles leave a wake.

That alpha value is the single most sensitive knob in the project. At 0.02 everything smears into soup. At 0.3 there is no trail at all. Expose it and tune it slowly.

---

## 8. Colour

Each particle stores the hue of the last finger that pushed it, decaying slowly back towards the rest colour.

The hues carry over from the original proof of concept: thumb amber, index teal, middle blue, ring violet, little finger rose. The result is that you paint with your fingers, and each finger leaves its own colour in the air.

It is a small detail and it is probably the best thing in the project. What was a debugging aid in the prototype is the whole idea here.

---

## 9. Recording

This is the part that decides whether the project gets shared. Do not leave it until the end.

- `canvas.captureStream(60)` into `MediaRecorder`, vp9 in webm.
- Record button with a visible countdown. Ten seconds, fixed, no decision about when to stop.
- On completion, `navigator.share` with the file. On mobile that opens the system share sheet and goes straight wherever the user wants. On desktop, download.
- The record button hides itself from the frame while recording.

If `navigator.share` refuses files, fall back to download.

---

## 10. Performance

- One hundred thousand particles on desktop, fifty thousand on mobile, chosen from `navigator.hardwareConcurrency` and adjustable by hand.
- The simulation itself is negligible. The bottlenecks are fill rate from additive blending and MediaPipe inference.
- Decouple detection from rendering: MediaPipe at 30 fps through `requestVideoFrameCallback`, simulation and rendering at 60 through `requestAnimationFrame`. Interpolate repulsor positions between detections. Without this, the hand hole advances in visible steps even though the field itself is smooth.
- Filter repulsors with One Euro before uploading them, with gentle settings. `minCutoff` 1.0, `beta` 0.03.

---

## 11. Interface

Nothing permanent over the field. Controls appear on tap and fade after three seconds.

- Record button.
- Mode toggle, flow or shape.
- Text field, visible in shape mode only.
- Collapsed settings: particle count, trail alpha, radius, strength.

A start screen with a single button, mandatory because of the camera permission. Use that screen to run one warm-up inference and precompile the shaders.

---

## 12. Milestones

- **M0.** WebGL2 with transform feedback, one hundred thousand particles moving under noise. No camera yet.
- **M1.** Accumulation trails and additive blending. It should already look good here.
- **M2.** Camera, tracking, repulsion. The moment the hand hole appears.
- **M3.** Colour per finger.
- **M4.** Recording and sharing.
- **M5.** Shape mode with text.

M2 is the moment of truth. If the hand hole does not feel immediate and physical, the problem is in the interpolation between detections or in the filter, not in the force.

---

## 13. Acceptance criteria

- Fifty thousand particles at 55 fps or better on a mid-range phone.
- The hand hole moves with no perceptible stepping even when detection runs at 25 fps.
- No particle ever flies off at absurd velocity.
- From opening the app to having a video in the share sheet: under twenty seconds.
- With hands out of frame, the field settles back to rest in under two seconds.

---

## 14. Things that are easy to forget

- Initialise velocities to zero and positions to a uniform distribution. Starting with random velocity gives an ugly first-second explosion.
- The front camera feed is mirrored. Since it is never drawn, the repulsor X coordinate has to be flipped manually or the hole appears on the wrong side.
- `preserveDrawingBuffer` must be false. Trails come from not clearing, not from preserving the buffer.
- Pause the simulation when the tab loses visibility, or the accumulated `dt` will detonate the field on return.
- Clamp `dt` to a maximum of 33 ms. One half-second hitch with the real `dt` disintegrates the simulation.
- Hold a Screen Wake Lock while the field is running.

---

## 15. Deferred, decide at M3

- **Depth.** MediaPipe returns a z coordinate per landmark, relative to the wrist. Using it turns the flat field into a volume the hand moves through. Additive blending needs no depth sorting, so the cost is low. The catch is that z is the noisiest channel in the landmark set, since it is inferred rather than measured, and it may need far heavier filtering than x and y. Build it next to the flat version and compare. If it does not clearly win, drop it.
- **Silhouette mode.** MediaPipe Image Segmenter provides a person mask. Painting only the cut-out silhouette on black, with particles around it, gives the sense that the field is reacting to a real body, without revealing the room and without WebXR. Self-contained and it does not touch the simulation.
