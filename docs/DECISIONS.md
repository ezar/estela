# Decisions

Where the implementation departs from [the specification](SPEC.md), and why.

## Trails accumulate into an offscreen texture

The specification asks for trails by never clearing the canvas, with
`preserveDrawingBuffer` false. Those two are in tension: with
`preserveDrawingBuffer` false, the contents of the default framebuffer are
undefined after the browser composites a frame, and most browsers do clear it.
Trails built that way work on some machines and produce a blank or flickering
canvas on others.

So the field accumulates into a texture that is genuinely never cleared, gets
the fade quad on top every frame, and is presented to the canvas through a
tonemap. `preserveDrawingBuffer` stays false, as required, and the trails are
deterministic everywhere. The accumulation target is `RGBA16F` where the
`EXT_color_buffer_half_float` extension exists and `RGBA8` otherwise; on eight
bit targets the last few units of a fading trail never round down to zero and
leave a faint permanent haze.

## The noise wraps with the world

Flow mode wraps the field: whatever leaves one edge comes back on the opposite
one. The curl noise did not wrap with it, so the force was discontinuous exactly
where particles teleported. A particle leaving the right edge reappeared on the
left, where the field often pushed it straight back out, and the pair of edges
turned into a trap. Measured on 60k particles, density in the outer 4% band
against the average over the whole field:

| after | before | after the fix |
| ----- | ------ | ------------- |
| 5 s   | 1.75x  | 0.91x         |
| 10 s  | 1.29x  | 1.00x         |
| 20 s  | 2.54x  | 0.85x         |

The swarm was slowly draining into a bright rim, and it kept getting worse.

The fix is to make the noise periodic over the same rectangle the world wraps
on. The plane is embedded in four dimensions as a torus, one circle per axis,
with radii chosen so arc length on the torus matches distance in the world, and
the potential is 4D simplex noise sampled there. Time translates along the
fourth axis, which animates the field without breaking the periodicity. It costs
one dimension of noise, four evaluations per particle either way.

## The curl field evolves faster than first tuned

Curl noise is divergence free, which is what the specification relies on to keep
the field from clumping. That holds for the field itself, but particles carry
inertia, and against a nearly static field they settle onto its attractors: the
swarm slowly tears into bright filaments separated by large voids.

Measured over 40k particles after ten seconds, on a 64 by 36 density grid:

| flow speed | flow force | drag | density CV | cells below 15% of mean |
| ---------- | ---------- | ---- | ---------- | ----------------------- |
| 0.12       | 0.35       | 0.94 | 2.79       | 66%                     |
| 0.30       | 0.35       | 0.94 | 2.05       | 52%                     |
| 0.12       | 0.90       | 0.86 | 2.19       | 54%                     |
| 0.35       | 0.60       | 0.90 | 1.07       | 18%                     |
| 0.45       | 1.00       | 0.85 | 0.87       | 12%                     |

The shipped defaults sit near the last row, with drag at 0.87 rather than the
0.94 the specification suggests. Drag also sets the damping the repulsion and
the shape spring are balanced against, so strength and spring were retuned with
it. All of it is exposed in Settings.

## Shape mode keeps a trace of the flow

With only a spring, a settled word has exactly zero velocity: the accumulation
buffer fills in and it stops looking like a swarm and starts looking like text
rendered in white. A small fraction of the flow field, 14% of the flow force,
is left on in shape mode. The word breathes and still holds its shape.

## Files beyond the specified tree

`gl/utils.ts` holds shader, program and buffer helpers. `sim/simulation.ts` and
`render/renderer.ts` hold the two passes the specified tree implies but does not
name. `render/quad.vert.glsl` is the full screen triangle shared by the fade and
present passes, and `render/present.frag.glsl` is the tonemap. Every shader
still lives in its own `.glsl` file and is imported as a string.

## The app unpacks its own assets

A first visit downloads the MediaPipe wasm runtime and the hand landmarker
model, 19 MB between them, and that is most of the twenty seconds the
specification allows between opening the app and having a video to share.

Normally the server compresses this and the browser transparently decompresses
it. GitHub Pages serves files exactly as it is given them and offers no way to
set `Content-Encoding`, so that route does not exist here. Nor can the browser
be asked to do it directly: `DecompressionStream` handles gzip and deflate, and
no browser exposes Brotli through it, verified on Chrome 141.

So the assets are Brotli compressed at build time and the app carries a 208 KB
Brotli decoder to unpack them. Measured:

| asset           | raw      | gzip    | brotli  |
| --------------- | -------- | ------- | ------- |
| vision wasm     | 11.15 MB | 3.27 MB | 2.30 MB |
| hand landmarker | 7.82 MB  | 5.81 MB | 5.37 MB |
| wasm loader     | 0.32 MB  | 0.08 MB | 0.07 MB |

A first visit measured end to end, served with no compression at all, went from
19.68 MB to 8.38 MB. The decoder is loaded on demand, so it costs nothing to
anyone who never turns the camera on, and the model weights are the floor: they
are float16 and barely compress. The uncompressed originals are deployed
alongside as a fallback and are never fetched unless a `.br` fails.

Choosing gzip instead would need no decoder at all and land at 9.16 MB, 0.8 MB
worse, and it is a one line change in `scripts/fetch-assets.mjs` and
`src/assets/compressed.ts` if the dependency is ever unwanted.

Compression is the slow part of the build: about 75 seconds at maximum quality
for the three files, skipped when the `.br` copies are already up to date.

## Still deferred

Depth from the landmark z channel and the segmentation silhouette mode are the
two decisions the specification defers to M3. Neither is built. The flat version
they were meant to be compared against is what exists today.
