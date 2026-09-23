// FrameForge WebM writer: builds a seekable WebM (EBML) file in memory from
// WebCodecs chunks. Written from the Matroska/WebM element tables; supports one
// video track (VP8/VP9) and an optional Opus audio track, clusters of <= 2 s,
// a Duration field and Cues so the result seeks in players.
(function (root) {
  const enc = new TextEncoder();
  function idBytes(id) { const b = []; while (id > 0) { b.unshift(id & 255); id = Math.floor(id / 256); } return b; }
  function vint(n, len) { // EBML size field
    if (!len) { len = 1; while (n >= 2 ** (7 * len) - 1) len++; }
    const b = new Array(len); let v = n;
    for (let i = len - 1; i >= 0; i--) { b[i] = v & 255; v = Math.floor(v / 256); }
    b[0] |= 1 << (8 - len); return b;
  }
  function uint(n) { const b = []; do { b.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0); return b; }
  function f64(x) { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, x); return [...a]; }
  // Elements are [id, payload] where payload is bytes (array/Uint8Array) or child element list.
  function size(el) { const p = payload(el); return idBytes(el[0]).length + vint(p.len, el[2]).length + p.len; }
  function payload(el) {
    const v = el[1];
    if (Array.isArray(v) && v.length && Array.isArray(v[0])) { let len = 0; for (const c of v) len += size(c); return { kids: v, len }; }
    return { bytes: v, len: v.length };
  }
  function write(el, out) {
    const p = payload(el); out.push(Uint8Array.from(idBytes(el[0])), Uint8Array.from(vint(p.len, el[2])));
    if (p.kids) for (const c of p.kids) write(c, out); else out.push(p.bytes instanceof Uint8Array ? p.bytes : Uint8Array.from(p.bytes));
  }
  const U = (id, n) => [id, uint(n)], S = (id, s) => [id, enc.encode(s)];

  function createWebM({ width, height, codec, audio }) {
    const vcodec = codec.startsWith('vp09') || codec === 'vp9' ? 'V_VP9' : 'V_VP8';
    const blocks = []; // {track, ts (µs), key, data}
    let opusHead = null;
    return {
      addVideo(chunk) { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); blocks.push({ track: 1, ts: chunk.timestamp, key: chunk.type === 'key', data: d }); },
      addAudio(chunk, meta) { if (meta?.decoderConfig?.description && !opusHead) opusHead = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description); const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); blocks.push({ track: 2, ts: chunk.timestamp, key: true, data: d }); },
      finish(durationSec) {
        blocks.sort((a, b) => a.ts - b.ts || a.track - b.track);
        const tracks = [[0xAE, [U(0xD7, 1), U(0x73C5, 1), U(0x83, 1), S(0x86, vcodec), [0xE0, [U(0xB0, width), U(0xBA, height)]]]]];
        if (audio) {
          const head = opusHead || Uint8Array.from([79, 112, 117, 115, 72, 101, 97, 100, 1, audio.channels, 0x38, 0x01, ...new Uint8Array(new Uint32Array([audio.sampleRate]).buffer), 0, 0, 0]);
          tracks.push([0xAE, [U(0xD7, 2), U(0x73C5, 2), U(0x83, 2), S(0x86, 'A_OPUS'), [0x63A2, head], U(0x56AA, 6500000), U(0x56BB, 80000000), [0xE1, [[0xB5, f64(audio.sampleRate)], U(0x9F, audio.channels)]]]]);
        }
        // clusters: start a new one at each video keyframe or after 2 s / 32767 ms relative limit
        const clusters = []; let cur = null;
        for (const b of blocks) {
          const ms = Math.round(b.ts / 1000);
          if (!cur || (b.track === 1 && b.key) || ms - cur.tc > 2000) { cur = { tc: ms, kids: [U(0xE7, ms)], key: b.track === 1 && b.key }; clusters.push(cur); }
          const rel = ms - cur.tc, hdr = [...vint(b.track), (rel >> 8) & 255, rel & 255, b.key ? 0x80 : 0];
          const blk = new Uint8Array(hdr.length + b.data.length); blk.set(hdr); blk.set(b.data, hdr.length);
          cur.kids.push([0xA3, blk]);
        }
        const clusterEls = clusters.map(c => [0x1F43B675, c.kids]);
        const info = [0x1549A966, [U(0x2AD7B1, 1000000), [0x4489, f64(durationSec * 1000)], S(0x4D80, 'FrameForge'), S(0x5741, 'FrameForge')]];
        const tracksEl = [0x1654AE6B, tracks];
        // SeekHead with fixed 8-byte positions so its size is known before layout
        const seek = (id, pos) => [0x4DBB, [[0x53AB, Uint8Array.from(idBytes(id))], [0x53AC, (() => { const a = []; let v = pos; for (let i = 0; i < 8; i++) { a.unshift(v & 255); v = Math.floor(v / 256); } return a; })()]]];
        const seekHeadLen = size([0x114D9B74, [seek(0x1549A966, 0), seek(0x1654AE6B, 0), seek(0x1C53BB6B, 0)]]);
        const infoPos = seekHeadLen, tracksPos = infoPos + size(info); let pos = tracksPos + size(tracksEl);
        const cuePoints = [];
        clusterEls.forEach((el, i) => { if (clusters[i].key) cuePoints.push([0xBB, [U(0xB3, clusters[i].tc), [0xB7, [U(0xF7, 1), U(0xF1, pos)]]]]); pos += size(el); });
        const cues = [0x1C53BB6B, cuePoints.length ? cuePoints : [[0xBB, [U(0xB3, 0), [0xB7, [U(0xF7, 1), U(0xF1, tracksPos + size(tracksEl))]]]]]];
        const seekHead = [0x114D9B74, [seek(0x1549A966, infoPos), seek(0x1654AE6B, tracksPos), seek(0x1C53BB6B, pos)]];
        const segment = [0x18538067, [seekHead, info, tracksEl, ...clusterEls, cues]];
        const ebml = [0x1A45DFA3, [U(0x4286, 1), U(0x42F7, 1), U(0x42F2, 4), U(0x42F3, 8), S(0x4282, 'webm'), U(0x4287, 4), U(0x4285, 2)]];
        const out = []; write(ebml, out); write(segment, out);
        return new Blob(out, { type: 'video/webm' });
      }
    };
  }
  root.ffWebM = { createWebM, _vint: vint };
})(typeof window !== 'undefined' ? window : globalThis);
