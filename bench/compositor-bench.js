// FrameForge dev benchmark (not loaded by the app): Canvas 2D + WebGL LUT round trip vs one WebGL2 context.
// Paste into the console of any page as the body of an async function; returns JSON with ms/frame and pixel parity.
const W = 1280, H = 720, N = 17;
// source "frames": two 1920x1080 generated images
const mk = (h1, h2) => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, h1); g.addColorStop(1, h2); x.fillStyle = g; x.fillRect(0, 0, 1920, 1080); for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 37 % 360} 70% 55%)`; x.fillRect((i * 97) % 1900, (i * 53) % 1060, 30, 20); } return c; };
const srcA = mk('#e0703a', '#402080'), srcB = mk('#2090c0', '#10301a');
// LUT: warm contrast curve
const lut = new Float32Array(N * N * N * 3); { let k = 0; for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) { const f = v => Math.min(1, Math.max(0, (v - .5) * 1.2 + .5)); lut[k++] = f(r / (N - 1)) * 1.05; lut[k++] = f(g / (N - 1)); lut[k++] = f(b / (N - 1)) * .9; } }
for (let i = 0; i < lut.length; i++) lut[i] = Math.min(1, lut[i]);
const layers = [
  { src: srcA, x: 0, y: 0, w: W, h: H, a: 1, rot: 0, lut: true },
  { src: srcB, x: 700, y: 380, w: 520, h: 292, a: .85, rot: .08, lut: false },
  { src: srcA, x: 60, y: 60, w: 400, h: 225, a: .7, rot: -.05, lut: true },
];
const VS = `#version 300 es
in vec2 p; uniform mat3 m; out vec2 uv; void main(){ uv = p; vec3 q = m * vec3(p, 1.); gl_Position = vec4(q.xy, 0., 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D; in vec2 uv; uniform sampler2D t; uniform sampler3D l; uniform float a, useL, n; out vec4 o;
void main(){ vec4 c = texture(t, uv); if (useL > .5) { vec3 s = c.rgb * ((n - 1.) / n) + .5 / n; c.rgb = texture(l, s).rgb; } o = vec4(c.rgb * c.a * a, c.a * a); }`;
function glSetup(cv) {
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const lt = gl.createTexture(); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, lt);
  const u8 = new Uint8Array(N * N * N * 4); for (let i = 0; i < N * N * N; i++) { u8[i * 4] = lut[i * 3] * 255 + .5; u8[i * 4 + 1] = lut[i * 3 + 1] * 255 + .5; u8[i * 4 + 2] = lut[i * 3 + 2] * 255 + .5; u8[i * 4 + 3] = 255; }
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0); const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(pr, 't'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'l'), 1); gl.uniform1f(gl.getUniformLocation(pr, 'n'), N);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return { gl, U: k => gl.getUniformLocation(pr, k) };
}
// B: single WebGL2 compositor
const cvB = document.createElement('canvas'); cvB.width = W; cvB.height = H; const B = glSetup(cvB);
const uM = B.U('m'), uA = B.U('a'), uL = B.U('useL');
function mat(L, cw, ch) { // unit quad -> clip space with rotation about center, y down
  const c = Math.cos(L.rot), s = Math.sin(L.rot), cx = L.x + L.w / 2, cy = L.y + L.h / 2;
  const ax = L.w * c, ay = L.w * s, bx = -L.h * s, by = L.h * c; // columns in pixel space
  const tx = cx - (ax + bx) / 2, ty = cy - (ay + by) / 2;
  const sx = 2 / cw, sy = -2 / ch;
  return new Float32Array([ax * sx, ay * sy, 0, bx * sx, by * sy, 0, tx * sx - 1, ty * sy + 1, 1]);
}
function frameB() { const gl = B.gl; gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); for (const L of layers) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.src); gl.uniformMatrix3fv(uM, false, mat(L, W, H)); gl.uniform1f(uA, L.a); gl.uniform1f(uL, L.lut ? 1 : 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } }
// A: current style: Canvas 2D compositing, LUT via separate GL canvas round trip on the layer's region
const cvA = document.createElement('canvas'); cvA.width = W; cvA.height = H; const ctx = cvA.getContext('2d');
const gc = document.createElement('canvas'), lc = document.createElement('canvas'); lc.width = W; lc.height = H; const G = glSetup(lc);
function lutRegion(ix, iy, iw, ih) { gc.width !== iw && (gc.width = iw); gc.height !== ih && (gc.height = ih); gc.getContext('2d').drawImage(cvA, ix, iy, iw, ih, 0, 0, iw, ih); const gl = G.gl; gl.viewport(0, 0, iw, ih); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, gc); gl.uniformMatrix3fv(G.U('m'), false, new Float32Array([2, 0, 0, 0, -2, 0, -1, 1, 1])); gl.uniform1f(G.U('a'), 1); gl.uniform1f(G.U('useL'), 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(lc, 0, lc.height - ih, iw, ih, ix, iy, iw, ih); ctx.restore(); }
function frameA() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); for (const L of layers) { ctx.save(); ctx.translate(L.x + L.w / 2, L.y + L.h / 2); ctx.rotate(L.rot); ctx.globalAlpha = L.a; ctx.drawImage(L.src, -L.w / 2, -L.h / 2, L.w, L.h); ctx.restore(); if (L.lut) { const r = Math.abs(Math.sin(L.rot)) * L.h / 2 + 2, ix = Math.max(0, Math.floor(L.x - r)), iy = Math.max(0, Math.floor(L.y - r)), iw = Math.min(W - ix, Math.ceil(L.w + 2 * r)), ih = Math.min(H - iy, Math.ceil(L.h + 2 * r)); lutRegion(ix, iy, iw, ih); } } }
const sink = document.createElement('canvas'); sink.width = sink.height = 1; const sx = sink.getContext('2d', { willReadFrequently: true });
const sync = cv => { sx.drawImage(cv, 0, 0, 1, 1); sx.getImageData(0, 0, 1, 1); };
async function bench(f, cv, n) { for (let i = 0; i < 5; i++) { f(); sync(cv); } const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); sync(cv); ts.push(performance.now() - t); await new Promise(r => setTimeout(r, 0)); } ts.sort((a, b) => a - b); return { median: +ts[n >> 1].toFixed(2), p90: +ts[Math.floor(n * .9)].toFixed(2) }; }
async function batch(f, cv, n) { f(); sync(cv); const t = performance.now(); for (let i = 0; i < n; i++) f(); sync(cv); return +((performance.now() - t) / n).toFixed(2); }
const texs = new Map(); function frameBc() { const gl = B.gl; gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); for (const L of layers) { let t = texs.get(L.src); if (!t) { t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, L.src); texs.set(L.src, t); } else gl.bindTexture(gl.TEXTURE_2D, t); gl.uniformMatrix3fv(uM, false, mat(L, W, H)); gl.uniform1f(uA, L.a); gl.uniform1f(uL, L.lut ? 1 : 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } }
const out = { renderer: (() => { const gl = B.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() };
out.A_canvas2d_plus_gl_lut = await bench(frameA, cvA, 60);
out.B_single_webgl2 = await bench(frameB, cvB, 60);
out.batch60_msPerFrame = { A: await batch(frameA, cvA, 60), B: await batch(frameB, cvB, 60), B_texturesCached: await batch(frameBc, cvB, 60) };
out.syncOnly = await bench(() => {}, cvB, 30);
// parity: note A applies LUT to the whole region (incl. underlying pixels) - compare only a region covered only by layer 0 (lut) and layer 1 (no lut) away from edges
frameA(); frameB();
const rd = cv => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(cv, 0, 0); return x.getImageData(0, 0, W, H).data; };
const a = rd(cvA), b = rd(cvB); let sum = 0, max = 0, cnt = 0, big = 0;
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { if (x > 40 && x < 480 && y > 40 && y < 310) continue; if (x > 680 && y > 330) continue; const i = (y * W + x) * 4; for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - b[i + k]); sum += d; cnt++; if (d > max) max = d; if (d > 3) big++; } }
out.parity_layer0 = { meanDiff: +(sum / cnt).toFixed(3), maxDiff: max, over3: +(big / cnt * 100).toFixed(3) + '%' };
return JSON.stringify(out);
