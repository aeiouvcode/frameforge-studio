// Rust compositor: parity vs the f64 JS reference and the Zig kernel, then kernel-only timing.
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../../core/test/parity.mjs',import.meta.url),'utf8');
const refSrc=src.slice(src.indexOf('function refComposite('),src.indexOf('\n',src.indexOf('function refComposite(')));
const refComposite=new Function(refSrc+';return refComposite')();
const rs=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/frameforge_compositor.wasm',import.meta.url))),{}).exports;
const zg=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(new URL('../../core/frameforge-core.wasm',import.meta.url))),{}).exports;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
ok(WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(new URL('../target/wasm32-unknown-unknown/release/frameforge_compositor.wasm',import.meta.url)))).length===0,'Rust module has zero imports');
function prep(dw,dh,sw,sh,m){const [a,b,c,d,e,f]=m,det=a*d-b*c,inv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];const xs=[e,a*sw+e,c*sh+e,a*sw+c*sh+e],ys=[f,b*sw+f,d*sh+f,b*sw+d*sh+f];return {inv,bb:[Math.floor(Math.min(...xs))-1,Math.floor(Math.min(...ys))-1,Math.ceil(Math.max(...xs))+1,Math.ceil(Math.max(...ys))+1]}}
function mk(ex,alloc,fn,dw,dh,sw,sh){const dp=alloc(dw*dh*4),sp=alloc(sw*sh*4),ip=alloc(24),bp=alloc(16);return {dp,sp,ip,bp,run(dst,srcA,m,op,bl,copy=true){const {inv,bb}=prep(dw,dh,sw,sh,m);const u8=new Uint8Array(ex.memory.buffer);if(copy){u8.set(dst,dp);u8.set(srcA,sp)}new Float32Array(ex.memory.buffer).set(inv,ip>>2);new Int32Array(ex.memory.buffer).set(bb,bp>>2);fn(dp,dw,dh,sp,sw,sh,ip,op,bl,bp);return new Uint8Array(ex.memory.buffer).slice(dp,dp+dw*dh*4)}}}
let s=12345;const rnd=()=>((s=(s*1103515245+12345)>>>0)/4294967296);
{const dw=320,dh=180,sw=200,sh=120;const srcA=new Uint8ClampedArray(sw*sh*4);for(let i=0;i<srcA.length;i++)srcA[i]=(rnd()*256)|0;
 const opq=new Uint8ClampedArray(srcA).map((v,i)=>i%4===3?255:v);
 const base=new Uint8ClampedArray(dw*dh*4);for(let i=0;i<base.length;i++)base[i]=i%4===3?255:(rnd()*256)|0;
 const semi=new Uint8ClampedArray(base).map((v,i)=>i%4===3?(i*7)&255:v);
 const K=mk(rs,rs.ff_rs_reserve,rs.ff_rs_composite,dw,dh,sw,sh);
 const cases=[['identity',[1,0,0,1,40,20],1,0],['scale+rotate',[Math.cos(.4)*1.3,Math.sin(.4)*1.3,-Math.sin(.4)*1.3,Math.cos(.4)*1.3,120,-10],.8,0],['screen',[0.7,0,0,0.7,10,30],.9,1],['multiply',[1.1,0,0,1.1,-20,-5],1,2],['add',[1,0.1,0,1,60,40],.5,3]];
 for(const [lbl,S,B] of [['alpha src',srcA,base],['opaque src',opq,base],['alpha src on semi-transparent dst',srcA,semi]])for(const [name,m,op,bl] of cases){const a=refComposite(new Uint8ClampedArray(B),dw,dh,S,sw,sh,m,op,bl),r=K.run(B,S,m,op,bl);let mx=0,n=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-r[i]);if(d){n++;mx=Math.max(mx,d)}}ok(mx<=1&&n/a.length<0.01,`${lbl} ${name}: max diff ${mx}, differing ${(n/a.length*100).toFixed(3)}%`)}}
// kernel-only timing (inputs already in wasm memory) at 1080p, opaque rotated layer, 80% opacity
const bench=(f,it)=>{f();f();const t=performance.now();for(let i=0;i<it;i++)f();return (performance.now()-t)/it};
{const W=1920,H=1080,s2=new Uint8ClampedArray(W*H*4).map((_,i)=>i%4===3?255:(i*37)&255),b2=new Uint8ClampedArray(W*H*4).fill(255),m=[Math.cos(.1),Math.sin(.1),-Math.sin(.1),Math.cos(.1),30,-40];
 const R=mk(rs,rs.ff_rs_reserve,rs.ff_rs_composite,W,H,W,H),Z=mk(zg,zg.ff_alloc,zg.ff_composite,W,H,W,H);
 const rr=R.run(b2,s2,m,.8,0),zz=Z.run(b2,s2,m,.8,0);let mx=0;for(let i=0;i<rr.length;i++)mx=Math.max(mx,Math.abs(rr[i]-zz[i]));ok(mx<=1,`1080p Rust vs Zig: max diff ${mx}`);{const rf=refComposite(new Uint8ClampedArray(b2),W,H,s2,W,H,m,.8,0);let mr=0,nr=0;for(let i=0;i<rf.length;i++){const d=Math.abs(rf[i]-rr[i]);if(d){nr++;mr=Math.max(mr,d)}}ok(mr<=1&&nr/rf.length<.01,`1080p Rust vs f64 reference: max diff ${mr}, differing ${(nr/rf.length*100).toFixed(3)}%`)}
 const tr=bench(()=>R.run(b2,s2,m,.8,0,false),8),tz=bench(()=>Z.run(b2,s2,m,.8,0,false),8),tj=bench(()=>refComposite(new Uint8ClampedArray(b2),W,H,s2,W,H,m,.8,0),2);
 const trc=bench(()=>R.run(b2,s2,m,.8,0,true),8);
 console.log(`BENCH composite 1080p kernel only: Rust ${tr.toFixed(1)} ms, Zig ${tz.toFixed(1)} ms, JS ref ${tj.toFixed(1)} ms; Rust with copies in/out ${trc.toFixed(1)} ms`)}
console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);
