# FrameForge security model

FrameForge is local-first. Imported media, projects, speech analysis, rendering and export stay in the browser. The application has no analytics, telemetry, account service, ad network or API-key field.

## Network boundary

The content security policy denies all origins by default. Runtime connections are limited to the application's own origin. Scripts, the ONNX runtime and the Silero model are vendored in this repository; no third-party CDN executes in the page. Frames, plugins, forms and cross-origin referrers are blocked.

## Local vault

The optional vault encrypts project metadata and imported media at rest with AES-GCM. A key is derived in tab memory from the passphrase with PBKDF2-SHA256 (310,000 iterations), a random 128-bit salt and random 96-bit IVs per record. The passphrase and derived key are not persisted. This protects browser storage at rest; it is not collaboration E2EE and cannot protect an already-compromised browser session.

## Input handling

Media, caption and LUT imports have size/type gates. User-visible strings inserted into generated markup pass through HTML escaping; renderer text is drawn as canvas text. Search, title, caption and timing fields have explicit length limits. FrameForge does not use `eval`, `new Function`, `document.write`, WebSockets, beacons or cross-origin fetches.

## Known residual risk

The app remains a single-file static editor and currently needs inline script/style CSP allowances plus WebAssembly evaluation for the vendored ONNX runtime. Removing those allowances requires splitting the application bundle and extracting styles. Treat this as defense-in-depth work still open, not proof of remote execution risk.

Report security issues through the repository's private owner contact rather than opening an issue that includes sensitive media or project data.
