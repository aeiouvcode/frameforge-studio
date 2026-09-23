# Rust compositor experiment (not shipped)

A from-scratch `no_std` Rust kernel, `ff_rs_composite`, compiled to `wasm32-unknown-unknown`. It has the same contract as the Zig `ff_composite`: straight-alpha source-over, an affine transform, bilinear sampling, opacity, and normal/screen/multiply/add blends. The module has no imports.

It adds a fixed-point fast path for the usual video case (normal blend onto an opaque frame) and steps the transform per pixel instead of recomputing it.

Build: `RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target wasm32-unknown-unknown`
Test: `node test/bench.mjs` (needs a built core/frameforge-core.wasm for the Zig comparison)

## Results

Parity: max 1/255 against the f64 JS reference and the Zig kernel in all 15 cases (3 source/backdrop mixes x 5 blends). At 1080p, 0.9% of channels differ.

Kernel only, 1080p rotated opaque layer at 80% opacity (node, 2-core sandbox):

| Kernel  | ms per frame |
|---------|--------------|
| Rust    | ~50-59       |
| Zig     | ~142         |
| JS JIT  | ~148         |

In the browser, 1080p, background plus a rotated 960x540 overlay (Chrome on a GTX 1650, 8 cores, median of 6 runs):

| Path                                                  | ms per frame |
|-------------------------------------------------------|--------------|
| Canvas 2D, frame stays on the GPU                     | 8.3          |
| Canvas 2D plus full readback (what CPU grading costs) | 22.7         |
| Rust CPU compositor plus upload                       | 35.2         |

Verdict: Rust beats Zig about 2.5x on the CPU kernel, but it still loses to the browser's own GPU compositing. Every video frame has to be read back to the CPU before a WASM compositor can touch it. So the renderer keeps Canvas 2D, and this module is not loaded by the app.
