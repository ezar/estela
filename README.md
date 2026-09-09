# enjambre

A field of one hundred thousand particles that reacts to your hands through the
webcam. No instructions, no goal, no score. Open it, move your hand, that is the
whole thing.

**The camera feed is never drawn.** Black background, particles only. The hand
is inferred from the hole it opens in the swarm, which is more elegant than any
skeleton overlay, and it means there is nothing personal on screen and nothing
personal in a recording.

## Running it

```bash
npm install
npm run dev
```

`npm run assets` runs on its own before `dev` and `build`. It copies the
MediaPipe wasm runtime out of `node_modules` and downloads the hand landmarker
model into `public/`, so nothing is fetched from a CDN at runtime. Both
directories are gitignored.

```bash
npm run build      # type check and produce dist/
npm run preview    # serve dist/
npm run lint
npm run format
```

The camera needs a secure context. `localhost` counts; on a phone over the local
network it does not, so use a tunnel or deploy.

## Deploying

Pushing to `main` publishes to GitHub Pages at
<https://ezar.github.io/estela/> through `.github/workflows/deploy.yml`. The
workflow turns Pages on the first time it runs, so there is nothing to set by
hand. It builds the same way you would locally, which means the model and the
wasm runtime are downloaded during the build rather than committed.

The build uses relative asset paths, so it works both from a subdirectory, as
on Pages, and from the root of a domain, as on Vercel.

## What is on screen

- **Flow**, the default. A curl noise field drags the particles into currents
  and whatever leaves one edge comes back on the opposite one.
- **Shape**. Every particle gets a rest position sampled from a rasterised word
  and a spring pulling it there, so hands break the word apart and it
  reassembles. The text field is the thing that makes every recording different.
- **Record**. Ten seconds of canvas straight into the system share sheet, or a
  download when the browser will not share files. The controls hide themselves
  while it runs.
- Controls appear on tap and fade after three seconds. Particle count, trail
  alpha, repulsion radius and strength are under Settings.

Each particle keeps the hue of the last finger that pushed it and decays slowly
back to the rest colour: thumb amber, index teal, middle blue, ring violet,
little finger rose. You paint with your fingers.

## How it works

```
camera  ──▶  HandLandmarker (30 Hz)  ──▶  One Euro filter  ──▶  42 repulsors
                                                                     │
                            interpolated between detections at 60 Hz │
                                                                     ▼
   transform feedback step  ──▶  additive points  ──▶  accumulation buffer
       (position, velocity, tint)                          (never cleared,
                                                            faded per frame)
```

- **Raw WebGL2, no three.js.** The whole simulation is two shaders.
- **Transform feedback, not texture ping pong.** The vertex shader writes the
  next position, velocity and tint straight into a buffer: one `drawArrays`, no
  textures, no CPU readback.
- **Detection is decoupled from rendering.** MediaPipe runs at about 30 Hz
  through `requestVideoFrameCallback` while the field runs at 60 through
  `requestAnimationFrame`, and every repulsor is interpolated between the last
  two detections. Without that the hole advances in visible steps even though
  the field itself is smooth.
- **The noise wraps with the world.** The plane is embedded in four dimensions
  as a torus so the curl field is exactly periodic across the seams the
  particles wrap on. A field that does not wrap turns both edges into a trap and
  the swarm drains into a bright rim.
- **The falloff is an inverted quadratic**, `(1 - d/R)²`, not an inverse square.
  It saturates at the rim on its own, so no particle is ever launched out of
  frame and no artificial clamp is needed.
- **Trails come from accumulation**, never from clearing: a black quad at alpha
  0.08 over the previous frame. That alpha is the most sensitive number in the
  project.

`src/tracking/` is kept behind a narrow interface that exposes nothing but a
list of 2D repulsors, so the detection engine can be swapped without touching
the simulation.

## Layout

```
src/
  main.ts                 orchestration, resize, visibility, wake lock
  camera/stream.ts        getUserMedia, processed every frame, never drawn
  tracking/
    landmarker.ts         HandLandmarker wrapper, 30 Hz
    repulsors.ts          21 points per hand into a flat uniform array
  filter/oneEuro.ts
  sim/
    buffers.ts            double buffered position, velocity and tint
    simulation.ts         the step pass
    step.vert.glsl        integration and forces
    step.frag.glsl        empty, output leaves through transform feedback
  render/
    renderer.ts           additive points, accumulation buffer, present
    draw.*.glsl
    fade.ts               the translucent quad that makes the trails
    quad.vert.glsl        full screen triangle, shared by fade and present
  modes/
    flow.ts               curl noise tuning
    shape.ts              rest positions from text or an image
  capture/recorder.ts     MediaRecorder and Web Share
  ui/hud.ts
  gl/utils.ts             shader, program and buffer helpers
```

## Requirements

WebGL2 and a camera. WebGL2 has shipped on effectively every device since iOS
15; if it is missing the app says so and stops rather than carrying a fallback
path. Without a camera the field still flows, it just cannot be pushed.

Documents: [the specification](docs/SPEC.md) and
[the decisions taken while building it](docs/DECISIONS.md).
