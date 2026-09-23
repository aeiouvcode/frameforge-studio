// FrameForge local speech recognition. Original runner for the Whisper tiny.en
// ONNX export on the vendored ONNX Runtime Web. Nothing loads until load() is
// called; every model file is SHA-256 checked before use and cached in OPFS.
(() => {
  'use strict';
  const SR = 16000, NFFT = 400, HOP = 160, NMEL = 80, NFRAMES = 3000, NSAMPLES = 480000;
  // Two packs: English-only tiny.en (default) and the multilingual tiny model.
  const PACKS = {
    en: { base: './vendor/models/whisper-tiny-en/', opfs: 'ff-speech-tiny-en', files: [
      { name: 'encoder.onnx', sha: '21712ecbe2d1078eaa206b41218a6dff945eb9ac0854b55fd584e8bc88b20368', bytes: 10124977 },
      { name: 'decoder-merged.onnx', parts: ['decoder-merged.onnx.00', 'decoder-merged.onnx.01', 'decoder-merged.onnx.02'], sha: 'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52', bytes: 30718858 },
      { name: 'tokens.json', sha: 'aaaee82ab6816c47c1e361c64e2220a03b8c246fd04e997261b7d0ca6067f8a7', bytes: 508246 }
    ] },
    multi: { base: './vendor/models/whisper-tiny/', opfs: 'ff-speech-tiny', files: [
      { name: 'encoder.onnx', sha: '03ff3c99ce804f79a42afd6212c9492eb75e55625926de66f8fc192e9567d336', bytes: 10124977 },
      { name: 'decoder-merged.onnx', parts: ['decoder-merged.onnx.00', 'decoder-merged.onnx.01', 'decoder-merged.onnx.02'], sha: '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3', bytes: 30719241 },
      { name: 'tokens.json', sha: '9c6aae2908bbef3c7ac331e5ed0d7782ba4704b19ca22bb65922d374b018807c', bytes: 565275 }
    ] }
  };
  let packName = 'en', BASE = PACKS.en.base, PACK = PACKS.en.files;
  const live_ = {};
  // " Um, uh, so, like, hmm, I mean, you know," in the model's tokenizer (rev 2575352d).
  const VERBATIM_PROMPT = [21039, 11, 21480, 11, 523, 11, 588, 11, 289, 3020, 11, 314, 1612, 11, 345, 760, 11];
  const packBytes = () => PACK.reduce((a, f) => a + f.bytes, 0);
  let kernel = null, enc = null, dec = null, vocab = null, filters = null, cosT = null, sinT = null, win = null, loading = null;
  // Switch packs; sessions stay loaded per pack so flipping back is free.
  function setPack(name) {
    if (!PACKS[name] || name === packName) return;
    live_[packName] = { enc, dec, vocab, loading };
    packName = name; BASE = PACKS[name].base; PACK = PACKS[name].files;
    ({ enc = null, dec = null, vocab = null, loading = null } = live_[name] || {});
  }

  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  async function opfsDir() {
    try { return await (await navigator.storage.getDirectory()).getDirectoryHandle(PACKS[packName].opfs, { create: true }); }
    catch { return null; }
  }
  async function getVerified(f, dir, onBytes) {
    if (dir) {
      try {
        const buf = await (await (await dir.getFileHandle(f.name)).getFile()).arrayBuffer();
        if (hex(await crypto.subtle.digest('SHA-256', buf)) === f.sha) { onBytes(f.bytes); return buf; }
      } catch { /* not cached yet */ }
    }
    // Large files ship as fixed-size parts (static-host upload limits); the SHA-256 covers the joined file.
    const parts = []; let got = 0;
    for (const name of f.parts || [f.name]) {
      const res = await fetch(BASE + name, { credentials: 'omit', cache: 'no-cache' });
      if (!res.ok) throw Error(`Speech model file missing (${res.status})`);
      const reader = res.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(value.length); if (got > f.bytes) throw Error('Speech model larger than expected'); }
    }
    const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    if (hex(await crypto.subtle.digest('SHA-256', buf)) !== f.sha) throw Error('Speech model failed its integrity check');
    if (dir) { try { const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable(); await w.write(buf); await w.close(); } catch { /* cache is optional */ } }
    return buf.buffer;
  }
  async function cached() {
    const dir = await opfsDir(); if (!dir) return false;
    for (const f of PACK) { try { if ((await (await dir.getFileHandle(f.name)).getFile()).size !== f.bytes) return false; } catch { return false; } }
    return true;
  }
  async function forget() { try { await (await navigator.storage.getDirectory()).removeEntry(PACKS[packName].opfs, { recursive: true }); } catch { } enc = dec = vocab = null; loading = null; }

  function load(onProgress = () => {}) {
    if (enc && dec && vocab) return Promise.resolve();
    return loading ||= (async () => {
      if (!window.ort) throw Error('ONNX Runtime unavailable');
      const dir = await opfsDir(), total = packBytes(), files = PACK; let done = 0;
      const tick = n => { done += n; onProgress(Math.min(1, done / total)); };
      const bufs = [];
      for (const f of files) bufs.push(await getVerified(f, dir, tick));
      const opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      enc = await ort.InferenceSession.create(new Uint8Array(bufs[0]), opt);
      dec = await ort.InferenceSession.create(new Uint8Array(bufs[1]), opt);
      if (dir) { try { const keep = new Set(files.map(f => f.name)); for await (const name of dir.keys()) if (!keep.has(name)) await dir.removeEntry(name); } catch { /* best effort */ } }
      vocab = JSON.parse(new TextDecoder().decode(bufs[2]));
      vocab.byteOf = byteDecoder();
      vocab.V = vocab.noTimestamps + 1 + 1501; // text + specials, then 1501 timestamp tokens (0.00-30.00 s)
      vocab.mask = new Uint8Array(vocab.V); for (const i of vocab.suppress) vocab.mask[i] = 1;
    })().catch(err => { loading = null; enc = dec = vocab = null; throw err; });
  }

  // GPT-2 style byte-level token alphabet, rebuilt from its definition.
  function byteDecoder() {
    const bs = []; for (let i = 33; i <= 126; i++) bs.push(i); for (let i = 161; i <= 172; i++) bs.push(i); for (let i = 174; i <= 255; i++) bs.push(i);
    const cs = bs.slice(); let n = 0; for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
    const m = new Map(); bs.forEach((b, i) => m.set(String.fromCharCode(cs[i]), b)); return m;
  }
  function detok(ids) {
    const bytes = []; for (const id of ids) { if (id >= vocab.eos) continue; for (const ch of vocab.tokens[id] || '') { const b = vocab.byteOf.get(ch); if (b !== undefined) bytes.push(b); } }
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/\s+/g, ' ').trim();
  }

  // Slaney mel filterbank and periodic Hann window, as defined by the model's training front end.
  function setup() {
    if (filters) return;
    const fsp = 200 / 3, minLog = 1000, minLogMel = minLog / fsp, step = Math.log(6.4) / 27;
    const toMel = f => f >= minLog ? minLogMel + Math.log(f / minLog) / step : f / fsp;
    const toHz = m => m >= minLogMel ? minLog * Math.exp(step * (m - minLogMel)) : fsp * m;
    const nf = NFFT / 2 + 1, top = toMel(SR / 2), pts = [];
    for (let i = 0; i < NMEL + 2; i++) pts.push(toHz(top * i / (NMEL + 1)));
    filters = new Float32Array(NMEL * nf);
    for (let m = 0; m < NMEL; m++) {
      const norm = 2 / (pts[m + 2] - pts[m]);
      for (let k = 0; k < nf; k++) {
        const f = k * SR / NFFT, lo = (f - pts[m]) / (pts[m + 1] - pts[m]), hi = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
        filters[m * nf + k] = Math.max(0, Math.min(lo, hi)) * norm;
      }
    }
    win = new Float32Array(NFFT); for (let n = 0; n < NFFT; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / NFFT);
    cosT = new Float32Array(nf * NFFT); sinT = new Float32Array(nf * NFFT);
    for (let k = 0; k < nf; k++) for (let n = 0; n < NFFT; n++) { const a = 2 * Math.PI * k * n / NFFT; cosT[k * NFFT + n] = Math.cos(a); sinT[k * NFFT + n] = Math.sin(a); }
  }
  function logMel(pcm, { js = false } = {}) {
    const useKernel = !js;
    setup();
    const x = new Float32Array(NSAMPLES); x.set(pcm.subarray(0, NSAMPLES));
    const pad = NFFT / 2, padded = new Float32Array(NSAMPLES + NFFT);
    padded.set(x, pad); for (let i = 0; i < pad; i++) { padded[pad - 1 - i] = x[i + 1]; padded[pad + NSAMPLES + i] = x[NSAMPLES - 2 - i]; }
    const nf = NFFT / 2 + 1, out = new Float32Array(NMEL * NFRAMES), frame = new Float32Array(NFFT), pow = new Float32Array(nf);
    const live = Math.min(NFRAMES, Math.ceil((Math.min(pcm.length, NSAMPLES) + NFFT) / HOP) + 1);
    let max = -Infinity;
    if (kernel && useKernel) {
      try {
        const m = kernel.logMel(padded, live, win, cosT, sinT, filters);
        for (let mm = 0; mm < NMEL; mm++) for (let t = 0; t < NFRAMES; t++) { const v = t < live ? m[mm * live + t] : -10; out[mm * NFRAMES + t] = v; if (v > max) max = v; }
        for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], max - 8) + 4) / 4;
        return out;
      } catch { kernel = null; }
    }
    for (let t = 0; t < NFRAMES; t++) {
      if (t < live) {
        for (let n = 0; n < NFFT; n++) frame[n] = padded[t * HOP + n] * win[n];
        for (let k = 0; k < nf; k++) { let re = 0, im = 0, o = k * NFFT; for (let n = 0; n < NFFT; n++) { re += frame[n] * cosT[o + n]; im -= frame[n] * sinT[o + n]; } pow[k] = re * re + im * im; }
      } else pow.fill(0);
      for (let m = 0; m < NMEL; m++) { let s = 0, o = m * nf; for (let k = 0; k < nf; k++) s += filters[o + k] * pow[k]; const v = Math.log10(Math.max(s, 1e-10)); out[m * NFRAMES + t] = v; if (v > max) max = v; }
    }
    for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], max - 8) + 4) / 4;
    return out;
  }

  // Greedy decode of one window of up to 30 s of 16 kHz mono audio. With
  // timestamps on, the model's own <|t|> tokens split the text into timed
  // segments, using the standard pairing and monotonic rules.
  // language: null for the English pack; 'auto' or a code such as 'hi' for the multilingual pack.
  async function detectLanguage(hidden) {
    const { logits, off } = await step_([vocab.sot], hidden, { past: null });
    let best = null, bv = -Infinity;
    for (const [code, id] of Object.entries(vocab.langs)) { const v = logits[off + id]; if (v > bv) { bv = v; best = code; } }
    return best;
  }
  async function transcribe(pcm, { maxTokens = 180, timestamps = true, verbatim = false, language = 'auto' } = {}) {
    await load();
    const t0 = performance.now();
    const feats = new ort.Tensor('float32', logMel(pcm), [1, NMEL, NFRAMES]);
    const eo = await enc.run({ [enc.inputNames[0]]: feats }), hidden = eo[enc.outputNames[0]];
    const t1 = performance.now();
    const V = vocab.V, TS = vocab.noTimestamps + 1, dur = Math.min(pcm.length, NSAMPLES) / SR;
    // Verbatim mode primes the decoder with a previous-text prompt full of fillers,
    // which makes Whisper keep "um" and "uh" instead of tidying them away.
    const prompt = verbatim && !vocab.langs ? [50360, ...VERBATIM_PROMPT] : [];
    let lang = null, head = [vocab.sot];
    if (vocab.langs) {
      lang = language && language !== 'auto' && vocab.langs[language] ? language : await detectLanguage(hidden);
      head = [vocab.sot, vocab.langs[lang], vocab.transcribe];
    }
    const ids = [...prompt, ...head, ...(timestamps ? [] : [vocab.noTimestamps])], outIds = [];
    let lastTs = 0; const cache = { past: null };
    for (let step = 0; step < maxTokens; step++) {
      const { logits, off } = await step_(ids, hidden, cache);
      const isTs = i => i >= TS, prev = outIds[outIds.length - 1], prev2 = outIds[outIds.length - 2];
      const allowText = !timestamps || !(outIds.length === 0 || (isTs(prev) && !isTs(prev2 ?? TS)));
      const allowTs = timestamps && !(outIds.length && isTs(prev) && isTs(prev2 ?? TS));
      const tsFloor = TS + Math.round(lastTs / 0.02), tsCeil = TS + Math.ceil(dur / 0.02);
      let bestText = -1, bt = -Infinity, bestTs = -1, bts = -Infinity, tsMass = -Infinity, textMax = -Infinity;
      for (let i = 0; i < V; i++) {
        const v = logits[off + i];
        if (i < TS) {
          if (vocab.mask[i] || (i > vocab.eos && i < TS)) continue;
          if (step === 0 && vocab.beginSuppress.includes(i)) continue;
          if (i !== vocab.eos && !allowText) continue;
          if (v > textMax) textMax = v;
          if (v > bt) { bt = v; bestText = i; }
        } else if (allowTs && i >= tsFloor && i <= tsCeil) {
          tsMass = tsMass === -Infinity ? v : Math.max(tsMass, v) + Math.log1p(Math.exp(-Math.abs(tsMass - v)));
          if (v > bts) { bts = v; bestTs = i; }
        }
      }
      let best = bestText;
      if (bestTs >= 0 && (bestText < 0 || tsMass > textMax)) best = bestTs;
      if (best === vocab.eos || best < 0) break;
      ids.push(best); outIds.push(best);
      if (isTs(best)) lastTs = (best - TS) * 0.02;
      const loop = stuck(outIds); if (loop) { outIds.length -= loop; break; } // hallucination guard
      if (outIds.length > 12 + dur * 10) break;
    }
    const segments = []; let cur = null, words = [];
    for (const id of outIds) {
      if (id >= TS) {
        const t = (id - TS) * 0.02;
        if (!cur) cur = { start: t };
        else { cur.end = t; cur.text = detok(words); if (cur.text) segments.push(cur); cur = null; words = []; }
      } else words.push(id);
    }
    if (words.length) { const text = detok(words); if (text) segments.push({ start: cur ? cur.start : (segments.at(-1)?.end ?? 0), end: dur, text }); }
    for (const sg of segments) { sg.start = Math.max(0, Math.min(dur, sg.start)); sg.end = Math.max(sg.start + 0.2, Math.min(dur, sg.end)); }
    return { text: detok(outIds), language: lang, segments, tokens: outIds.length, encodeMs: Math.round(t1 - t0), totalMs: Math.round(performance.now() - t0) };
  }

  // Length to trim when the tail is a repeating token loop: a 1-4 token pattern four or more
  // times, or a longer 5-16 token pattern (a multi-token word or phrase) three times.
  function stuck(ids) {
    for (let p = 1; p <= 16; p++) {
      const times = p <= 4 ? 4 : 3;
      if (ids.length < p * times) continue;
      let rep = true;
      for (let i = ids.length - p * (times - 1); i < ids.length && rep; i++) if (ids[i] !== ids[i - p]) rep = false;
      if (rep) return p * (times - 1); // tokens to drop so one copy stays
    }
    return 0;
  }

  // One decoder step. The merged export keeps a key/value cache between steps,
  // so after the prompt only the newest token is fed; older exports re-run the sequence.
  const EMPTY = () => new ort.Tensor('float32', new Float32Array(0), [1, 6, 0, 64]);
  async function step_(ids, hidden, cache) {
    const V = vocab.V, cached = dec.inputNames.includes('use_cache_branch');
    if (!cached) {
      const inp = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
      const feeds = {}; for (const n of dec.inputNames) feeds[n] = /hidden/.test(n) ? hidden : inp;
      const r = await dec.run(feeds);
      return { logits: r[dec.outputNames[0]].data, off: (ids.length - 1) * V };
    }
    const first = !cache.past, feed = first ? ids : ids.slice(-1);
    const feeds = { input_ids: new ort.Tensor('int64', BigInt64Array.from(feed.map(BigInt)), [1, feed.length]), encoder_hidden_states: hidden, use_cache_branch: new ort.Tensor('bool', [!first], [1]) };
    for (const n of dec.inputNames) if (n.startsWith('past_key_values.')) feeds[n] = first ? EMPTY() : cache.past[n];
    const r = await dec.run(feeds), past = {};
    for (const n of dec.outputNames) if (n.startsWith('present.')) {
      const k = n.replace('present.', 'past_key_values.');
      past[k] = (!first && k.includes('.encoder.')) ? cache.past[k] : r[n];
    }
    cache.past = past;
    return { logits: r.logits.data, off: (feed.length - 1) * V };
  }

  window.ffWhisper = { useCore(k) { kernel = k && k.logMel ? k : null; }, get kernel() { return kernel ? 'zig' : 'js'; }, load, transcribe, cached, forget, logMel, setPack, get pack() { return packName; }, get packBytes() { return packBytes(); }, get languages() { return vocab?.langs ? Object.keys(vocab.langs) : null; }, get ready() { return !!(enc && dec && vocab); } };
})();
