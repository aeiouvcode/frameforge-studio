// Bench-only WebGL2 scope path (not shipped: slower than CPU in measurement).
(function(root){const {OUT_W,OUT_H,VK}=root.ffScopes,SW=320;
  function makeGpu() {
    const c = document.createElement('canvas'); c.width = OUT_W; c.height = OUT_H;
    const gl = c.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const vs = `#version 300 es
    uniform sampler2D u_src; uniform ivec2 u_grid; uniform int u_mode;
    out float v_w;
    void main(){
      int x = gl_VertexID % u_grid.x, y = gl_VertexID / u_grid.x;
      vec2 uv = (vec2(x, y) + .5) / vec2(u_grid);
      vec3 c = texture(u_src, uv).rgb * 255.;
      float Y = dot(c, vec3(.2126, .7152, .0722));
      vec2 p;
      if (u_mode == 1) { float cb = (c.b - Y) / 1.8556, cr = (c.r - Y) / 1.5748; vec2 b = clamp(floor(vec2(${OUT_W / 2}.0 + cb * ${VK.toFixed(6)}, ${OUT_H / 2}.0 + cr * ${VK.toFixed(6)}) + .5), vec2(0.), vec2(${OUT_W - 1}.0, ${OUT_H - 1}.0)); p = (b + .5) / vec2(${OUT_W}.0, ${OUT_H}.0) * 2. - 1.; }
      else { p = vec2((floor(float(x) * ${OUT_W}.0 / float(u_grid.x)) + .5) / ${OUT_W}.0 * 2. - 1., (min(floor(Y * ${OUT_H}.0 / 256.), ${OUT_H - 1}.0) + .5) / ${OUT_H}.0 * 2. - 1.); }
      gl_Position = vec4(p, 0., 1.); gl_PointSize = 1.;
    }`;
    const fs = `#version 300 es
    precision highp float; uniform float u_k; out vec4 o;
    void main(){ o = vec4(u_k); }`;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(x)); return x; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(pr));
    // accumulate counts in a float target, then tone-map to the canvas
    const hasF = !!gl.getExtension('EXT_color_buffer_float');
    const acc = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, acc);
    gl.texImage2D(gl.TEXTURE_2D, 0, hasF ? gl.R32F : gl.RGBA8, OUT_W, OUT_H, 0, hasF ? gl.RED : gl.RGBA, hasF ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc, 0);
    const tvs = `#version 300 es
    out vec2 uv; void main(){ vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2. - 1.; uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
    const tfs = `#version 300 es
    precision highp float; uniform sampler2D u_acc; uniform float u_k; in vec2 uv; out vec4 o;
    void main(){ float a = texture(u_acc, uv).r; float v = floor(255. * (1. - exp(-a * u_k / 40.)) + .5) / 255.; o = vec4(v * .55, v * .8, v, 1.); }`;
    const tp = gl.createProgram(); gl.attachShader(tp, sh(gl.VERTEX_SHADER, tvs)); gl.attachShader(tp, sh(gl.FRAGMENT_SHADER, tfs)); gl.linkProgram(tp);
    const src = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const U = n => gl.getUniformLocation(pr, n);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return {
      kind: 'webgl2', floatAcc: hasF,
      render(srcCanvas, dst, mode) {
        const W = Math.min(SW, srcCanvas.width), H = Math.max(1, Math.round(W * srcCanvas.height / srcCanvas.width));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, OUT_W, OUT_H);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pr); gl.uniform1i(U('u_src'), 0); gl.uniform2i(U('u_grid'), W, H); gl.uniform1i(U('u_mode'), mode === 'vector' ? 1 : 0);
        gl.uniform1f(U('u_k'), hasF ? 1 : 1 / 255);
        gl.drawArrays(gl.POINTS, 0, W * H);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, OUT_W, OUT_H);
        gl.useProgram(tp); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, acc); gl.uniform1i(gl.getUniformLocation(tp, 'u_acc'), 1);
        const n = W * H, k = mode === 'vector' ? 18 / Math.sqrt(n / 1000) : OUT_W * 18 / (n / OUT_W);
        gl.uniform1f(gl.getUniformLocation(tp, 'u_k'), (hasF ? 1 : 255) * k);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        dst.getContext('2d').drawImage(c, 0, 0);
        return { samples: n, W, H };
      }
    };
  }
  root.ffScopes.makeGpu=makeGpu;})(window);
