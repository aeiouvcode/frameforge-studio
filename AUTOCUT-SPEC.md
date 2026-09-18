# FrameForge Auto Cut engine spec

## Privacy and runtime
All inference and editing run in the browser or on localhost. Runtime/model assets are vendored with the app, covered by the CSP, and never fetched from a CDN. Same-origin fetch is limited to these static local files. Audio samples, transcripts, LUTs and edit decisions never leave the device.

## Silence removal
1. Decode selected audio into a mono 16 kHz analysis buffer.
2. Run a vendored Silero VAD ONNX session in fixed windows.
3. Convert probabilities into speech intervals using separate start/end thresholds, a hangover, and user-set pre/post padding (100 ms default).
4. Merge close intervals, clamp them to the clip, and produce a reversible cut plan before mutation.
5. Apply to every selected linked A/V clip as ripple edits. Locked tracks block the operation.

## Restart markers
1. Run a vendored Whisper-compatible WASM/Transformers.js transcription model locally with word timestamps.
2. Match normalized consecutive `cut cut` tokens, including punctuation/casing variants.
3. For each marker, identify the current take from the previous retained boundary to the marker and propose its deletion. Keep marker padding separate from VAD padding.
4. Show the transcript, confidence, affected ranges and resulting duration before apply. Overlap resolution is deterministic.

## Voice chain
Per voice track: 80 Hz high-pass -> 3 kHz presence peaking EQ -> compressor -> measured gain toward -16 LUFS. The LUFS gain is analysis-derived, clamped, and applied before the existing track/master gain. Preview and export use the same chain.

## LUT grading
Parse common 1D/3D `.cube` files locally, validate title/domain/size/row count, cap 3D size, and use tetrahedral/trilinear interpolation. Preview and export share the same renderer. Invalid LUTs do not mutate a clip.

## Swivel teaser
A short preview insert generated from a later marked range. It accelerates toward the insert while applying a perspective-like horizontal squash, rotation cue and motion blur, then returns to the source. The edit is represented in timeline data, not only as a transient preview effect.

## Acceptance gates
- deterministic unit vectors for VAD interval planning and restart-marker planning
- locked-track and undo checks
- preview/export audio-chain parity
- `.cube` parser rejects malformed/oversized input and passes identity/color vectors
- teaser has stable frames at entry/mid/exit
- no network APIs; model/runtime asset hashes recorded
- desktop and phone visual checks; real-device performance called out separately
