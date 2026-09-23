# FrameForge Core (Zig → WebAssembly)

The performance core of FrameForge. The browser shell (UI, timeline, storage, export muxing) stays in JavaScript; pixel and signal kernels move here, one at a time, behind a parity test.

**Shipped in core v1 (ABI 1)**
- `ff_lut_apply` - trilinear 3D LUT grading on RGBA8 frames (preview and export). ~58x faster than the previous JS path in Node/V8 at 480×270 and 1080p.
- `ff_peaks` - exact per-bin waveform peaks (the JS path sampled every ~30th sample and could miss transients).
- `ff_luma_hist` - Rec.709 luma histogram. Measured at parity with JS, so the scope stays on JS for now.

- `ff_composite` - straight-alpha source-over with affine transform, bilinear sampling, opacity and normal/screen/multiply/add blends. Parity-tested (max 1/255). **Not wired into the renderer:** at 1080p it measured level with an equivalent V8 JIT loop (~142 vs ~147 ms), so moving CPU compositing into Zig alone buys nothing. The renderer keeps Canvas 2D until the compositor moves to the GPU, with Zig owning the frame graph and transform math.

**Security properties**
- The module has zero imports: no host functions, no I/O, no network. It can only read and write buffers the shell passes it.
- The shell fetches it from the same origin, checks its SHA-256 against the pin in `index.html`, and falls back to JavaScript on any mismatch or error.

**Build**: `sh core/build.sh` (Zig 0.16.x). It rebuilds, re-pins the hash, updates `vendor/SHA256SUMS` and runs `core/test/parity.mjs`.

**Next kernels (planned order)**: GPU compositor (WebGL2) driven by a Zig frame graph → scrub-frame cache and downscaler → audio mixer (gain, fades, pan) → Auto Cut pre-processing (resample, framing) → WebCodecs decode pipeline feeding frames straight into core memory.
