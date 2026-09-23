//! FrameForge Core - Zig compiled to WebAssembly.
//! Pixel, scope and audio kernels for the browser editor. No imports, no I/O,
//! no network: the module only reads and writes buffers the JS shell hands it.
const std = @import("std");

const ABI_VERSION: u32 = 1;
const gpa = std.heap.wasm_allocator;

export fn ff_abi_version() u32 {
    return ABI_VERSION;
}

/// Allocate `len` bytes in linear memory. Returns 0 on failure.
export fn ff_alloc(len: usize) usize {
    const buf = gpa.alloc(u8, len) catch return 0;
    return @intFromPtr(buf.ptr);
}

export fn ff_free(ptr: usize, len: usize) void {
    if (ptr == 0 or len == 0) return;
    const p: [*]u8 = @ptrFromInt(ptr);
    gpa.free(p[0..len]);
}

inline fn clampf(v: f32, lo: f32, hi: f32) f32 {
    return @max(lo, @min(hi, v));
}

inline fn toByte(v: f32) u8 {
    // Matches JS Math.round for non-negative values after clamping.
    const c = clampf(v * 255.0, 0.0, 255.0);
    return @intFromFloat(@floor(c + 0.5));
}

/// Apply a 3D LUT (trilinear) in place to RGBA8 pixels.
/// lut: size^3 * 3 f32 values, red fastest (Adobe .cube order).
/// domain: 6 f32 values [minR,minG,minB,maxR,maxG,maxB].
export fn ff_lut_apply(px_ptr: usize, px_len: usize, lut_ptr: usize, size: u32, domain_ptr: usize) void {
    if (size < 2 or px_len < 4) return;
    const px: [*]u8 = @ptrFromInt(px_ptr);
    const lut: [*]const f32 = @ptrFromInt(lut_ptr);
    const dom: [*]const f32 = @ptrFromInt(domain_ptr);
    const n: usize = size;
    const nm1: f32 = @floatFromInt(n - 1);
    var scale: [3]f32 = undefined;
    var off: [3]f32 = undefined;
    inline for (0..3) |c| {
        const span = dom[3 + c] - dom[c];
        scale[c] = if (span == 0) 0 else nm1 / span / 255.0;
        off[c] = if (span == 0) 0 else -dom[c] * nm1 / span;
    }
    // Input is 8-bit, so every per-channel lattice coordinate is one of 256 values.
    // Precompute lattice offsets and weights once per call instead of per pixel.
    var lo: [3][256]u32 = undefined;
    var hi: [3][256]u32 = undefined;
    var fr: [3][256]f32 = undefined;
    const strides = [3]usize{ 3, n * 3, n * n * 3 };
    inline for (0..3) |c| {
        var v: usize = 0;
        while (v < 256) : (v += 1) {
            const p = clampf(@as(f32, @floatFromInt(v)) * scale[c] + off[c], 0, nm1);
            const k0: usize = @intFromFloat(@floor(p));
            const k1 = @min(n - 1, k0 + 1);
            lo[c][v] = @intCast(k0 * strides[c]);
            hi[c][v] = @intCast(k1 * strides[c]);
            fr[c][v] = p - @as(f32, @floatFromInt(k0));
        }
    }
    var i: usize = 0;
    while (i + 3 < px_len) : (i += 4) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const x0 = lo[0][r];
        const x1 = hi[0][r];
        const y0 = lo[1][g];
        const y1 = hi[1][g];
        const z0 = lo[2][b];
        const z1 = hi[2][b];
        const tx = fr[0][r];
        const ty = fr[1][g];
        const tz = fr[2][b];
        const a000 = x0 + y0 + z0;
        const a100 = x1 + y0 + z0;
        const a010 = x0 + y1 + z0;
        const a110 = x1 + y1 + z0;
        const a001 = x0 + y0 + z1;
        const a101 = x1 + y0 + z1;
        const a011 = x0 + y1 + z1;
        const a111 = x1 + y1 + z1;
        inline for (0..3) |c| {
            const e0 = lut[a000 + c] + (lut[a100 + c] - lut[a000 + c]) * tx;
            const e1 = lut[a010 + c] + (lut[a110 + c] - lut[a010 + c]) * tx;
            const e2 = lut[a001 + c] + (lut[a101 + c] - lut[a001 + c]) * tx;
            const e3 = lut[a011 + c] + (lut[a111 + c] - lut[a011 + c]) * tx;
            const f0 = e0 + (e1 - e0) * ty;
            const f1 = e2 + (e3 - e2) * ty;
            px[i + c] = toByte(f0 + (f1 - f0) * tz);
        }
    }
}

/// Exact per-bin absolute peak of a mono f32 signal. Writes `bins` f32 values.
export fn ff_peaks(samples_ptr: usize, n: usize, bins: u32, out_ptr: usize) void {
    const s: [*]const f32 = @ptrFromInt(samples_ptr);
    const out: [*]f32 = @ptrFromInt(out_ptr);
    const b: usize = bins;
    if (b == 0) return;
    var k: usize = 0;
    while (k < b) : (k += 1) {
        const start = n * k / b;
        const end = n * (k + 1) / b;
        var m: f32 = 0;
        var j = start;
        while (j < end) : (j += 1) m = @max(m, @abs(s[j]));
        out[k] = m;
    }
}

/// Luma histogram (Rec.709, 64 bins) over every `step`-th RGBA pixel.
/// Writes 64 u32 counts, returns average luma * 1000 as u32.
export fn ff_luma_hist(px_ptr: usize, px_len: usize, step: u32, out_ptr: usize) u32 {
    const px: [*]const u8 = @ptrFromInt(px_ptr);
    const out: [*]u32 = @ptrFromInt(out_ptr);
    @memset(out[0..64], 0);
    const stride: usize = @as(usize, @max(1, step)) * 4;
    var sum: f64 = 0;
    var count: usize = 0;
    var i: usize = 0;
    while (i + 3 < px_len) : (i += stride) {
        const y = 0.2126 * @as(f32, @floatFromInt(px[i])) + 0.7152 * @as(f32, @floatFromInt(px[i + 1])) + 0.0722 * @as(f32, @floatFromInt(px[i + 2]));
        const bin: usize = @min(63, @as(usize, @intFromFloat(y)) >> 2);
        out[bin] += 1;
        sum += y;
        count += 1;
    }
    if (count == 0) return 0;
    return @intFromFloat(sum / @as(f64, @floatFromInt(count)) * 1000.0);
}

/// Composite one RGBA8 layer onto an RGBA8 frame (straight alpha, like ImageData).
/// inv: 6 f32 inverse affine [a,b,c,d,e,f] mapping dst pixel centre (x,y) to
/// src coords: sx = a*x + c*y + e, sy = b*x + d*y + f. Bilinear sampling,
/// transparent outside the source. blend: 0 normal, 1 screen, 2 multiply, 3 add.
/// bbox: 4 i32 [x0,y0,x1,y1] destination rows/cols to visit (clamped here).
export fn ff_composite(dst_ptr: usize, dw: u32, dh: u32, src_ptr: usize, sw: u32, sh: u32, inv_ptr: usize, opacity: f32, blend: u32, bbox_ptr: usize) void {
    if (sw == 0 or sh == 0 or opacity <= 0) return;
    const dst: [*]u8 = @ptrFromInt(dst_ptr);
    const src: [*]const u8 = @ptrFromInt(src_ptr);
    const m: [*]const f32 = @ptrFromInt(inv_ptr);
    const bb: [*]const i32 = @ptrFromInt(bbox_ptr);
    const x0: usize = @intCast(std.math.clamp(bb[0], 0, @as(i32, @intCast(dw))));
    const y0: usize = @intCast(std.math.clamp(bb[1], 0, @as(i32, @intCast(dh))));
    const x1: usize = @intCast(std.math.clamp(bb[2], 0, @as(i32, @intCast(dw))));
    const y1: usize = @intCast(std.math.clamp(bb[3], 0, @as(i32, @intCast(dh))));
    const swf: f32 = @floatFromInt(sw);
    const shf: f32 = @floatFromInt(sh);
    const op = clampf(opacity, 0, 1);
    var y = y0;
    while (y < y1) : (y += 1) {
        const fy: f32 = @as(f32, @floatFromInt(y)) + 0.5;
        var x = x0;
        while (x < x1) : (x += 1) {
            const fx: f32 = @as(f32, @floatFromInt(x)) + 0.5;
            const sx = m[0] * fx + m[2] * fy + m[4] - 0.5;
            const sy = m[1] * fx + m[3] * fy + m[5] - 0.5;
            if (sx <= -1 or sy <= -1 or sx >= swf or sy >= shf) continue;
            const ix0f = @floor(sx);
            const iy0f = @floor(sy);
            const tx = sx - ix0f;
            const ty = sy - iy0f;
            const ix0: i32 = @intFromFloat(ix0f);
            const iy0: i32 = @intFromFloat(iy0f);
            // Premultiplied bilinear so transparent edges do not bleed colour.
            var acc = [4]f32{ 0, 0, 0, 0 };
            const interior = ix0 >= 0 and iy0 >= 0 and ix0 + 1 < @as(i32, @intCast(sw)) and iy0 + 1 < @as(i32, @intCast(sh));
            if (interior) {
                const p00 = (@as(usize, @intCast(iy0)) * sw + @as(usize, @intCast(ix0))) * 4;
                const p10 = p00 + 4;
                const p01 = p00 + sw * 4;
                const p11 = p01 + 4;
                const w00 = (1 - tx) * (1 - ty);
                const w10 = tx * (1 - ty);
                const w01 = (1 - tx) * ty;
                const w11 = tx * ty;
                if ((src[p00 + 3] & src[p10 + 3] & src[p01 + 3] & src[p11 + 3]) == 255) {
                    // Opaque source: plain bilinear, no premultiply.
                    inline for (0..3) |c| acc[c] = @as(f32, @floatFromInt(src[p00 + c])) * w00 + @as(f32, @floatFromInt(src[p10 + c])) * w10 + @as(f32, @floatFromInt(src[p01 + c])) * w01 + @as(f32, @floatFromInt(src[p11 + c])) * w11;
                    acc[3] = 1;
                } else {
                    const idx = [4]usize{ p00, p10, p01, p11 };
                    const ws = [4]f32{ w00, w10, w01, w11 };
                    inline for (0..4) |k| {
                        const w = ws[k] * @as(f32, @floatFromInt(src[idx[k] + 3])) / 255.0;
                        acc[0] += @as(f32, @floatFromInt(src[idx[k]])) * w;
                        acc[1] += @as(f32, @floatFromInt(src[idx[k] + 1])) * w;
                        acc[2] += @as(f32, @floatFromInt(src[idx[k] + 2])) * w;
                        acc[3] += w;
                    }
                }
            } else inline for (0..4) |k| {
                const ox: i32 = if (k & 1 == 1) 1 else 0;
                const oy: i32 = if (k & 2 == 2) 1 else 0;
                const wx = if (ox == 1) tx else 1 - tx;
                const wy = if (oy == 1) ty else 1 - ty;
                const px = ix0 + ox;
                const py = iy0 + oy;
                if (px >= 0 and py >= 0 and px < @as(i32, @intCast(sw)) and py < @as(i32, @intCast(sh))) {
                    const si = (@as(usize, @intCast(py)) * sw + @as(usize, @intCast(px))) * 4;
                    const w = wx * wy * @as(f32, @floatFromInt(src[si + 3])) / 255.0;
                    acc[0] += @as(f32, @floatFromInt(src[si])) * w;
                    acc[1] += @as(f32, @floatFromInt(src[si + 1])) * w;
                    acc[2] += @as(f32, @floatFromInt(src[si + 2])) * w;
                    acc[3] += w;
                }
            }
            if (acc[3] <= 0.0) continue;
            const a = acc[3] * op;
            const di = (y * dw + x) * 4;
            const da = @as(f32, @floatFromInt(dst[di + 3])) / 255.0;
            const oa = a + da * (1 - a);
            inline for (0..3) |c| {
                const s = acc[c] / acc[3];
                const d: f32 = @floatFromInt(dst[di + c]);
                const mixed: f32 = switch (blend) {
                    1 => 255.0 - (255.0 - s) * (255.0 - d) / 255.0,
                    2 => s * d / 255.0,
                    3 => @min(255.0, s + d),
                    else => s,
                };
                // Blend result replaces the source colour where the layer overlaps an opaque backdrop.
                const sc = mixed * da + s * (1 - da);
                const outc = if (dst[di + 3] == 255) sc * a + d * (1 - a) else (sc * a + d * da * (1 - a)) / oa;
                dst[di + c] = @intFromFloat(@floor(clampf(outc, 0, 255) + 0.5));
            }
            dst[di + 3] = @intFromFloat(@floor(clampf(oa * 255.0, 0, 255) + 0.5));
        }
    }
}
