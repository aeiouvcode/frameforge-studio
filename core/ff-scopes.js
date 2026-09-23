// FrameForge scopes: luma waveform and vectorscope from the program canvas.
// CPU path: 320-column downsample, readback, binning (about 3 ms a frame).
// A WebGL2 point-splat path was measured slower here; it lives in bench/scope-gpu.js.
(function (root) {
  const SW = 320;                 // sampled columns
  const OUT_W = 256, OUT_H = 128; // scope raster
  const VK = (OUT_H / 2 - 2) / 128;  // chroma units -> scope pixels
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
          else { bx = Math.min(OUT_W - 1, ((p % W) * OUT_W / W) | 0); by = OUT_H - 1 - Math.min(OUT_H - 1, (y * OUT_H / 256) | 0); }
          acc[by * OUT_W + bx]++;
        }
        const n = d.length / 4, k = mode === 'vector' ? 18 / Math.sqrt(n / 1000) : OUT_W * 18 / (n / OUT_W) ;
        img ||= new ImageData(OUT_W, OUT_H); const o = img.data;
        for (let j = 0; j < acc.length; j++) { const v = acc[j] ? Math.max(70, Math.min(255, Math.round(255 * (1 - Math.exp(-acc[j] * k / 40))))) : 0; o[j * 4] = v * .55; o[j * 4 + 1] = v * .8; o[j * 4 + 2] = v; o[j * 4 + 3] = 255; }
        dst.getContext('2d').putImageData(img, 0, 0);
        return { avg: sum / n, samples: n, W, H };
      }
    };
  }
  root.ffScopes = { OUT_W, OUT_H, VK, ycc, makeCpu, graticule };
})(window);
