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
