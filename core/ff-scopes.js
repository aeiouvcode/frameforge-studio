// FrameForge scopes: luma waveform and vectorscope from the program canvas.
// CPU path: 320-column downsample, readback, binning (about 3 ms a frame).
// A WebGL2 point-splat path was measured slower here; it lives in bench/scope-gpu.js.
(function (root) {
  const SW = 320;                 // sampled columns
  const OUT_W = 256, OUT_H = 128; // scope raster
  const VK = (OUT_H / 2 - 2) / 128;  // chroma units -> scope pixels
  const PG = 4, PW = (OUT_W - 2 * PG) / 3 | 0; // parade: three 84 px lanes, 4 px gaps
  const TINT = [.55, .8, 1], PR = [1, .38, .34], PGN = [.4, 1, .45], PB = [.42, .58, 1];
  function ycc(r, g, b) { const y = .2126 * r + .7152 * g + .0722 * b; return [y, (b - y) / 1.8556, (r - y) / 1.5748]; }

  // Reference marks drawn over the raster: luma levels for the waveform,
  // 75% colour-bar targets and the skin-tone line for the vectorscope.
  function graticule(ctx, mode) {
    ctx.save(); ctx.lineWidth = 1; ctx.font = '9px system-ui'; ctx.textBaseline = 'middle';
    if (mode === 'vector') {
      const cx = OUT_W / 2, cy = OUT_H / 2, R = 128 * VK / 1.8556 * 1.0;
      ctx.strokeStyle = 'rgba(160,170,190,.28)'; ctx.beginPath(); ctx.arc(cx, cy, OUT_H / 2 - 2, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - OUT_H / 2, cy); ctx.lineTo(cx + OUT_H / 2, cy); ctx.moveTo(cx, 2); ctx.lineTo(cx, OUT_H - 2); ctx.stroke();
      const sk = ycc(224, 172, 140), sl = Math.hypot(sk[1], sk[2]);
      ctx.strokeStyle = 'rgba(232,176,144,.55)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + sk[1] / sl * (OUT_H / 2 - 2), cy - sk[2] / sl * (OUT_H / 2 - 2)); ctx.stroke();
      [['R', 191, 0, 0], ['Mg', 191, 0, 191], ['B', 0, 0, 191], ['Cy', 0, 191, 191], ['G', 0, 191, 0], ['Yl', 191, 191, 0]].forEach(([n, r, g, b]) => {
        const [, cb, cr] = ycc(r, g, b), x = cx + cb * VK, y = cy - cr * VK;
        ctx.strokeStyle = 'rgba(200,210,230,.6)'; ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
        ctx.fillStyle = 'rgba(200,210,230,.7)'; ctx.fillText(n, x + 6, y);
      });
    } else {
      if (mode === 'parade') { ctx.fillStyle = 'rgba(200,210,230,.55)'; ['R', 'G', 'B'].forEach((n, i) => ctx.fillText(n, i * (PW + PG) + PW - 9, 7)); }
      [0, 25, 50, 75, 100].forEach(v => { const y = Math.round(OUT_H - 1 - v / 100 * (OUT_H - 1)) + .5; ctx.strokeStyle = 'rgba(160,170,190,.22)'; ctx.beginPath(); ctx.moveTo(18, y); ctx.lineTo(OUT_W, y); ctx.stroke(); ctx.fillStyle = 'rgba(160,170,190,.7)'; ctx.fillText(String(v), 1, Math.min(OUT_H - 5, Math.max(5, y))); });
    }
    ctx.restore();
  }
  function makeCpu() {
    let tmp = null, img = null, acc = new Uint32Array(OUT_W * OUT_H);
    return {
      kind: 'cpu',
      render(src, dst, mode) {
        const W = Math.min(SW, src.width), H = Math.max(1, Math.round(W * src.height / src.width));
        tmp ||= document.createElement('canvas'); if (tmp.width !== W || tmp.height !== H) { tmp.width = W; tmp.height = H; }
        const lx = tmp.getContext('2d', { willReadFrequently: true }); lx.drawImage(src, 0, 0, W, H);
        const d = lx.getImageData(0, 0, W, H).data; acc.fill(0);
        let sum = 0;
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const r = d[i], g = d[i + 1], b = d[i + 2], y = .2126 * r + .7152 * g + .0722 * b; sum += y;
          let bx, by;
          if (mode === 'vector') { const cb = (b - y) / 1.8556, cr = (r - y) / 1.5748; bx = Math.min(OUT_W - 1, Math.max(0, Math.round(OUT_W / 2 + cb * VK))); by = Math.min(OUT_H - 1, Math.max(0, Math.round(OUT_H / 2 - cr * VK))); }
          else if (mode === 'parade') {
            const c = ((p % W) * PW / W) | 0, row = OUT_H - 1;
            acc[(row - ((r * OUT_H) >> 8)) * OUT_W + c]++; acc[(row - ((g * OUT_H) >> 8)) * OUT_W + PW + PG + c]++; acc[(row - ((b * OUT_H) >> 8)) * OUT_W + 2 * (PW + PG) + c]++;
            continue;
          }
          else { bx = Math.min(OUT_W - 1, ((p % W) * OUT_W / W) | 0); by = OUT_H - 1 - Math.min(OUT_H - 1, (y * OUT_H / 256) | 0); }
          acc[by * OUT_W + bx]++;
        }
        const n = d.length / 4, k = mode === 'vector' ? 18 / Math.sqrt(n / 1000) : mode === 'parade' ? PW * 18 / (n / PW) : OUT_W * 18 / (n / OUT_W);
        img ||= new ImageData(OUT_W, OUT_H); const o = img.data;
        for (let j = 0; j < acc.length; j++) { const v = acc[j] ? Math.max(70, Math.min(255, Math.round(255 * (1 - Math.exp(-acc[j] * k / 40))))) : 0; let t = TINT; if (mode === 'parade') { const x = j % OUT_W; t = x < PW ? PR : x < 2 * PW + PG ? PGN : PB; } o[j * 4] = v * t[0]; o[j * 4 + 1] = v * t[1]; o[j * 4 + 2] = v * t[2]; o[j * 4 + 3] = 255; }
        dst.getContext('2d').putImageData(img, 0, 0);
        return { avg: sum / n, samples: n, W, H };
      }
    };
  }

  // Zebra: diagonal stripes over areas at or above a luma threshold, drawn onto
  // the preview only (never export). Luma comes from the same 320 px proxy.
  function makeZebra() {
    let tmp = null, mask = null, mimg = null, stripes = null, pattern = null;
    return function draw(ctx, src, thr = 242) {
      const W = Math.min(SW, src.width), H = Math.max(1, Math.round(W * src.height / src.width));
      tmp ||= document.createElement('canvas'); if (tmp.width !== W || tmp.height !== H) { tmp.width = W; tmp.height = H; mask = null; }
      const lx = tmp.getContext('2d', { willReadFrequently: true }); lx.drawImage(src, 0, 0, W, H);
      const d = lx.getImageData(0, 0, W, H).data;
      if (!mask) { mask = document.createElement('canvas'); mask.width = W; mask.height = H; mimg = new ImageData(W, H); }
      const m = mimg.data; let hot = 0;
      for (let i = 0; i < d.length; i += 4) { const on = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2] >= thr; m[i + 3] = on ? 255 : 0; hot += on; }
      if (!hot) return 0;
      const mx = mask.getContext('2d'); mx.globalCompositeOperation = 'copy'; mx.putImageData(mimg, 0, 0);
      // Overlay at 2x proxy size: a cached black/white stripe tile, cut to the mask.
      const ow = W * 2, oh = H * 2;
      if (!pattern || pattern.width !== ow || pattern.height !== oh) {
        pattern = document.createElement('canvas'); pattern.width = ow; pattern.height = oh;
        const px = pattern.getContext('2d'); px.fillStyle = 'rgba(0,0,0,.8)'; px.fillRect(0, 0, ow, oh);
        px.strokeStyle = 'rgba(255,255,255,.9)'; px.lineWidth = 3; px.beginPath();
        for (let x = -oh; x < ow + oh; x += 8) { px.moveTo(x, oh); px.lineTo(x + oh, 0); }
        px.stroke();
        stripes = document.createElement('canvas'); stripes.width = ow; stripes.height = oh;
      }
      const sx = stripes.getContext('2d'); sx.globalCompositeOperation = 'copy'; sx.drawImage(pattern, 0, 0);
      sx.globalCompositeOperation = 'destination-in'; sx.imageSmoothingEnabled = false; sx.drawImage(mask, 0, 0, ow, oh);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(stripes, 0, 0, src.width, src.height); ctx.restore();
      return hot / (d.length / 4);
    };
  }

  // False colour: luma bands painted over the preview so exposure reads at a
  // glance. Bands are percent of full range; between bands the pixel shows as grey.
  const FC_BANDS = [[0, 3, [106, 44, 145], 'Crushed'], [3, 10, [31, 79, 216], 'Shadow'], [38, 48, [63, 174, 74], 'Mid grey'], [55, 65, [229, 143, 176], 'Skin'], [90, 97, [242, 209, 58], 'Bright'], [97, 101, [229, 50, 45], 'Clipped']];
  function makeFalseColour() {
    let tmp = null, out = null, img = null; const lut = new Uint8ClampedArray(256 * 3);
    for (let v = 0; v < 256; v++) { const pc = v / 255 * 100, b = FC_BANDS.find(([a, z]) => pc >= a && pc < z), c = b ? b[2] : [v * .8, v * .8, v * .8]; lut.set(c, v * 3); }
    return function draw(ctx, src) {
      const W = Math.min(480, src.width), H = Math.max(1, Math.round(W * src.height / src.width));
      tmp ||= document.createElement('canvas'); if (tmp.width !== W || tmp.height !== H) { tmp.width = W; tmp.height = H; out = null; }
      const lx = tmp.getContext('2d', { willReadFrequently: true }); lx.drawImage(src, 0, 0, W, H);
      const d = lx.getImageData(0, 0, W, H).data;
      if (!out) { out = document.createElement('canvas'); out.width = W; out.height = H; img = new ImageData(W, H); }
      const o = img.data, hist = new Uint32Array(FC_BANDS.length + 1);
      for (let i = 0; i < d.length; i += 4) { const y = (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) | 0, k = y * 3; o[i] = lut[k]; o[i + 1] = lut[k + 1]; o[i + 2] = lut[k + 2]; o[i + 3] = 255; if (y >= 248) hist[5]++; }
      out.getContext('2d').putImageData(img, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(out, 0, 0, src.width, src.height); ctx.restore();
      return hist[5] / (d.length / 4);
    };
  }
  root.ffScopes = { OUT_W, OUT_H, VK, ycc, makeCpu, makeZebra, makeFalseColour, FC_BANDS, graticule };
})(window);
