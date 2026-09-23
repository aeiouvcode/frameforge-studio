# FrameForge Studio

A local-first browser video editor. Imported media, project state, captions and renders stay on the device. The app has no analytics, cloud sync or application server.

![FrameForge Studio editor](docs/screenshot.jpg)

**Live:** https://aeiouvcode.github.io/frameforge-studio/

## Run on localhost

Python 3:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`.

Node.js:

```sh
npx --yes serve -l 4173 .
```

Use the Python command when you do not want `npx` to download anything. Do not expose this server on `0.0.0.0` unless you intentionally want other devices on the network to reach it.

## Security model

- Local-only IndexedDB and Origin Private File System storage
- Strict Content Security Policy: no network connections, forms, plugins or base URL changes
- Blob/data media only
- Context-correct HTML escaping for imported names and captions
- Input size/type validation
- No API keys or secrets

The hosted GitHub Pages copy is the same static client. Pages serves files only; editing and storage remain in the browser.

## Auto Cut local model pack

The bundle vendors ONNX Runtime Web, Silero VAD ONNX, Transformers.js and quantized Whisper Tiny English model assets under `vendor/`. `vendor/SHA256SUMS` records every shipped runtime/model asset. No CDN is used. WebAssembly requires the narrow CSP capability `wasm-unsafe-eval`; ordinary JavaScript eval remains blocked. The first analysis can take longer while local model files are read and compiled.
