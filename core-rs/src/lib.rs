//! FrameForge compositor kernel, written from scratch in Rust for wasm32.
//! No imports, no allocator from the host: JS writes into regions carved
//! from this module's own linear memory via ff_rs_reserve.
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

static mut HEAP_TOP: usize = 0;

/// Grow memory so that `bytes` more are available and return the start offset.
/// Regions are bump-allocated; ff_rs_reset frees all of them at once.
#[no_mangle]
pub extern "C" fn ff_rs_reserve(bytes: u32) -> u32 {
    unsafe {
        extern "C" {
            static __heap_base: u8;
        }
        let base = core::ptr::addr_of!(__heap_base) as usize;
        if HEAP_TOP < base {
            HEAP_TOP = base;
        }
        let start = (HEAP_TOP + 15) & !15;
        let end = start + bytes as usize;
        let have = core::arch::wasm32::memory_size(0) * 65536;
        if end > have {
            let pages = (end - have + 65535) / 65536;
            if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
                return 0;
            }
        }
        HEAP_TOP = end;
        start as u32
    }
}

#[no_mangle]
pub extern "C" fn ff_rs_reset() {
    unsafe { HEAP_TOP = 0 }
}

#[inline(always)]
fn clampf(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo { lo } else if v > hi { hi } else { v }
}

#[inline(always)]
fn round_u8(v: f32) -> u8 {
    // floor(clamp(v)+0.5), matching the JS reference
    (clampf(v, 0.0, 255.0) + 0.5) as u8
}

/// Composite one straight-alpha RGBA8 layer onto an RGBA8 frame.
/// Same contract and math as the Zig ff_composite: inverse affine `inv`
/// [a,b,c,d,e,f] maps dst pixel centres to src coords, bilinear sampling,
/// blend 0 normal / 1 screen / 2 multiply / 3 add, bbox [x0,y0,x1,y1].
#[no_mangle]
pub unsafe extern "C" fn ff_rs_composite(
    dst: *mut u8, dw: u32, dh: u32,
    src: *const u8, sw: u32, sh: u32,
    inv: *const f32, opacity: f32, blend: u32, bbox: *const i32,
) {
    if sw == 0 || sh == 0 || !(opacity > 0.0) {
        return;
    }
    let m = core::slice::from_raw_parts(inv, 6);
    let bb = core::slice::from_raw_parts(bbox, 4);
    let cl = |v: i32, hi: u32| -> usize { if v < 0 { 0 } else if v as u32 > hi { hi as usize } else { v as usize } };
    let (x0, y0, x1, y1) = (cl(bb[0], dw), cl(bb[1], dh), cl(bb[2], dw), cl(bb[3], dh));
    let (swu, shu) = (sw as usize, sh as usize);
    let (swf, shf) = (sw as f32, sh as f32);
    let op = clampf(opacity, 0.0, 1.0);
    let dst = core::slice::from_raw_parts_mut(dst, dw as usize * dh as usize * 4);
    let src = core::slice::from_raw_parts(src, swu * shu * 4);
    // Fast path for the usual video case: normal blend onto an opaque frame.
    // Fixed-point (Q11 bilinear weights, Q16 opacity) lerp in integer registers; pixels
    // that need the general path (edges, alpha, non-opaque dst) fall through.
    let opq = (op * 65536.0 + 0.5) as u64; // Q16, 0..=65536
    let fast = blend == 0;
    for y in y0..y1 {
        let fy = y as f32 + 0.5;
        let row = y * dw as usize * 4;
        // f64 stepping so error does not build up across a 4K row.
        let (m0, m1) = (m[0] as f64, m[1] as f64);
        let mut sxr = m0 * (x0 as f64 + 0.5) + m[2] as f64 * fy as f64 + m[4] as f64 - 0.5;
        let mut syr = m1 * (x0 as f64 + 0.5) + m[3] as f64 * fy as f64 + m[5] as f64 - 0.5;
        for x in x0..x1 {
            let sx = sxr as f32;
            let sy = syr as f32;
            sxr += m0;
            syr += m1;
            if fast && sx >= 0.0 && sy >= 0.0 && sx < swf - 1.0 && sy < shf - 1.0 {
                let di = row + x * 4;
                if *dst.get_unchecked(di + 3) == 255 {
                    let ix = sx as usize;
                    let iy = sy as usize;
                    let p00 = (iy * swu + ix) * 4;
                    let p01 = p00 + swu * 4;
                    let a00 = u32::from_le_bytes([*src.get_unchecked(p00), *src.get_unchecked(p00 + 1), *src.get_unchecked(p00 + 2), *src.get_unchecked(p00 + 3)]);
                    let a10 = u32::from_le_bytes([*src.get_unchecked(p00 + 4), *src.get_unchecked(p00 + 5), *src.get_unchecked(p00 + 6), *src.get_unchecked(p00 + 7)]);
                    let a01 = u32::from_le_bytes([*src.get_unchecked(p01), *src.get_unchecked(p01 + 1), *src.get_unchecked(p01 + 2), *src.get_unchecked(p01 + 3)]);
                    let a11 = u32::from_le_bytes([*src.get_unchecked(p01 + 4), *src.get_unchecked(p01 + 5), *src.get_unchecked(p01 + 6), *src.get_unchecked(p01 + 7)]);
                    if (a00 & a10 & a01 & a11) >> 24 == 255 {
                        let tx = ((sx - ix as f32) * 2048.0 + 0.5) as u32;
                        let ty = ((sy - iy as f32) * 2048.0 + 0.5) as u32;
                        let (w00, w10, w01, w11) = ((2048 - tx) * (2048 - ty), tx * (2048 - ty), (2048 - tx) * ty, tx * ty); // sum 2^22
                        for k in 0..3 {
                            let sh8 = k * 8;
                            let c = ((a00 >> sh8) & 255) * w00 + ((a10 >> sh8) & 255) * w10 + ((a01 >> sh8) & 255) * w01 + ((a11 >> sh8) & 255) * w11; // Q22
                            let d = *dst.get_unchecked(di + k as usize) as u32;
                            // out = c*op + d*(1-op): c Q22 * op Q16 -> Q38
                            let v = (c as u64 * opq + ((d as u64) << 22) * (65536 - opq) + (1u64 << 37)) >> 38;
                            *dst.get_unchecked_mut(di + k as usize) = v as u8;
                        }
                        continue;
                    }
                }
            }
            if sx <= -1.0 || sy <= -1.0 || sx >= swf || sy >= shf {
                continue;
            }
            let ixf = floorf(sx);
            let iyf = floorf(sy);
            let tx = sx - ixf;
            let ty = sy - iyf;
            let ix = ixf as i32;
            let iy = iyf as i32;
            let di = row + x * 4;
            let interior = ix >= 0 && iy >= 0 && ((ix + 1) as usize) < swu && ((iy + 1) as usize) < shu;
            let (w00, w10, w01, w11) = ((1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty);
            if interior {
                let p00 = (iy as usize * swu + ix as usize) * 4;
                let p10 = p00 + 4;
                let p01 = p00 + swu * 4;
                let p11 = p01 + 4;
                let s = src.get_unchecked(p00..p11 + 4);
                let o10 = 4;
                let o01 = p01 - p00;
                let o11 = p11 - p00;
                if (s[3] & s[o10 + 3] & s[o01 + 3] & s[o11 + 3]) == 255 {
                    // Opaque source. With an opaque backdrop and normal blend
                    // (the usual video case) the whole pixel is a lerp.
                    let d = dst.get_unchecked_mut(di..di + 4);
                    let mut c = [0f32; 3];
                    for k in 0..3 {
                        c[k] = s[k] as f32 * w00 + s[o10 + k] as f32 * w10 + s[o01 + k] as f32 * w01 + s[o11 + k] as f32 * w11;
                    }
                    if d[3] == 255 && blend == 0 {
                        for k in 0..3 {
                            d[k] = round_u8(c[k] * op + d[k] as f32 * (1.0 - op));
                        }
                        continue;
                    }
                    finish(d, c, 1.0, op, blend);
                    continue;
                }
                let mut acc = [0f32; 4];
                for (off, w0) in [(0usize, w00), (o10, w10), (o01, w01), (o11, w11)] {
                    let w = w0 * s[off + 3] as f32 / 255.0;
                    acc[0] += s[off] as f32 * w;
                    acc[1] += s[off + 1] as f32 * w;
                    acc[2] += s[off + 2] as f32 * w;
                    acc[3] += w;
                }
                if acc[3] <= 0.0 { continue; }
                let a = acc[3];
                finish(dst.get_unchecked_mut(di..di + 4), [acc[0] / a, acc[1] / a, acc[2] / a], a, op, blend);
            } else {
                let mut acc = [0f32; 4];
                for k in 0..4 {
                    let ox = (k & 1) as i32;
                    let oy = ((k >> 1) & 1) as i32;
                    let wx = if ox == 1 { tx } else { 1.0 - tx };
                    let wy = if oy == 1 { ty } else { 1.0 - ty };
                    let px = ix + ox;
                    let py = iy + oy;
                    if px >= 0 && py >= 0 && (px as usize) < swu && (py as usize) < shu {
                        let si = (py as usize * swu + px as usize) * 4;
                        let w = wx * wy * src[si + 3] as f32 / 255.0;
                        acc[0] += src[si] as f32 * w;
                        acc[1] += src[si + 1] as f32 * w;
                        acc[2] += src[si + 2] as f32 * w;
                        acc[3] += w;
                    }
                }
                if acc[3] <= 0.0 { continue; }
                let a = acc[3];
                finish(&mut dst[di..di + 4], [acc[0] / a, acc[1] / a, acc[2] / a], a, op, blend);
            }
        }
    }
}

#[inline(always)]
fn floorf(v: f32) -> f32 {
    let t = v as i32 as f32;
    if t > v { t - 1.0 } else { t }
}

#[inline(always)]
fn finish(d: &mut [u8], s: [f32; 3], cov: f32, op: f32, blend: u32) {
    let a = cov * op;
    let da = d[3] as f32 / 255.0;
    let oa = a + da * (1.0 - a);
    for k in 0..3 {
        let dc = d[k] as f32;
        let sc0 = s[k];
        let mixed = match blend {
            1 => 255.0 - (255.0 - sc0) * (255.0 - dc) / 255.0,
            2 => sc0 * dc / 255.0,
            3 => { let t = sc0 + dc; if t > 255.0 { 255.0 } else { t } }
            _ => sc0,
        };
        let sc = mixed * da + sc0 * (1.0 - da);
        let out = if d[3] == 255 { sc * a + dc * (1.0 - a) } else { (sc * a + dc * da * (1.0 - a)) / oa };
        d[k] = round_u8(out);
    }
    d[3] = round_u8(oa * 255.0);
}
