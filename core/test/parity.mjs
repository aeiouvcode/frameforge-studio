// Parity + benchmark: Zig/WASM core vs the shipping JS kernels extracted from index.html.
import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const grab=n=>{const i=html.indexOf('function '+n+'(');let d=0,j=html.indexOf('{',i);for(;j<html.length;j++){if(html[j]=='{')d++;else if(html[j]=='}'&&--d==0)break}return html.slice(i,j+1)};
// Native-speed JS (no vm context) so the benchmark reflects real V8 JIT behaviour.
const ctx=new Function('ffCore',grab('sampleCube')+grab('applyLutPixels')+grab('parseCube')+';return {sampleCube,applyLutPixels,parseCube}')(null);
new Function(fs.readFileSync(new URL('../ffcore-bridge.js',import.meta.url),'utf8'))();ctx.createFFCore=globalThis.createFFCore;
const core=ctx.createFFCore(new WebAssembly.Module(fs.readFileSync(new URL('../frameforge-core.wasm',import.meta.url))));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
// deterministic RNG
let s=12345;const rnd=()=>((s=(s*1103515245+12345)>>>0)/4294967296);
// Build a non-trivial 33^3 LUT (teal/orange grade with gamma) in .cube text so parseCube is exercised.
function cube(n,dmin=[0,0,0],dmax=[1,1,1]){let t=`LUT_3D_SIZE ${n}\nDOMAIN_MIN ${dmin.join(' ')}\nDOMAIN_MAX ${dmax.join(' ')}\n`;for(let b=0;b<n;b++)for(let g=0;g<n;g++)for(let r=0;r<n;r++){let R=r/(n-1),G=g/(n-1),B=b/(n-1);t+=`${Math.min(1,Math.pow(R,.85)*1.05).toFixed(6)} ${(G*.95+.02).toFixed(6)} ${Math.pow(B,1.15).toFixed(6)}\n`}return t}
for(const [n,dmin,dmax] of [[33,[0,0,0],[1,1,1]],[17,[0,0,0],[1,1,1]],[65,[0,0,0],[1,1,1]],[9,[.05,.05,.05],[.95,.95,.95]]]){
  const lut=ctx.parseCube(cube(n,dmin,dmax));const W=320,H=180,px=new Uint8ClampedArray(W*H*4);for(let i=0;i<px.length;i++)px[i]=(rnd()*256)|0;
  const a={data:new Uint8ClampedArray(px)},b=new Uint8ClampedArray(px);ctx.applyLutPixels(a,lut);core.lutApply(b,lut);
  let maxd=0,diff=0;for(let i=0;i<px.length;i++){const d=Math.abs(a.data[i]-b[i]);if(d){diff++;maxd=Math.max(maxd,d)}}
  ok(maxd<=1&&diff/px.length<0.01,`LUT ${n}^3 domain ${dmin[0]}-${dmax[0]}: max channel diff ${maxd}, differing ${(diff/px.length*100).toFixed(3)}% (f32 vs f64 rounding)`);
}
// peaks: exact vs brute force
{const n=48000*7+13,x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=Math.sin(i*.013)*(rnd()-.5)*1.8;const bins=80,p=core.peaks(x,bins);let bad=0;for(let k=0;k<bins;k++){let m=0;for(let j=Math.floor(n*k/bins);j<Math.floor(n*(k+1)/bins);j++)m=Math.max(m,Math.abs(x[j]));if(Math.abs(m-p[k])>1e-7)bad++}ok(bad===0,`Waveform peaks exact over ${n} samples, ${bins} bins`)}
// luma histogram vs JS updateScope math
{const W=1280,H=720,d=new Uint8ClampedArray(W*H*4);for(let i=0;i<d.length;i++)d[i]=(rnd()*256)|0;const bins=new Uint32Array(64);let avg=0,c=0;for(let i=0;i<d.length;i+=64){let y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];bins[Math.min(63,y>>2)]++;avg+=y;c++}avg/=c;const z=core.lumaHist(d,16);let bd=0;for(let i=0;i<64;i++)bd+=Math.abs(bins[i]-z.bins[i]);ok(bd<=c*0.001&&Math.abs(avg-z.avg)<0.05,`Luma scope histogram: bin delta ${bd}/${c}, avg ${avg.toFixed(3)} vs ${z.avg.toFixed(3)}`)}
// security: no imports
ok(WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(new URL('../frameforge-core.wasm',import.meta.url)))).length===0,'Core module has zero imports (no host/network capability)');
// benchmark
const bench=(f,it)=>{f();const t=performance.now();for(let i=0;i<it;i++)f();return (performance.now()-t)/it};
for(const [W,H] of [[480,270],[1920,1080]]){const lut=ctx.parseCube(cube(33));const px=new Uint8ClampedArray(W*H*4);for(let i=0;i<px.length;i++)px[i]=(rnd()*256)|0;
  const it=W>1000?2:10;const js=bench(()=>ctx.applyLutPixels({data:new Uint8ClampedArray(px)},lut),it),zg=bench(()=>core.lutApply(new Uint8ClampedArray(px),lut),it);
  console.log(`BENCH LUT ${W}x${H}: JS ${js.toFixed(2)} ms, Zig ${zg.toFixed(2)} ms, ${(js/zg).toFixed(1)}x`)}
{const d=new Uint8ClampedArray(1920*1080*4);for(let i=0;i<d.length;i++)d[i]=(rnd()*256)|0;const js=bench(()=>{const b=new Uint32Array(64);let a=0;for(let i=0;i<d.length;i+=16){let y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];b[Math.min(63,y>>2)]++;a+=y}},20),zg=bench(()=>core.lumaHist(d,4),20);console.log(`BENCH scope 1080p full-res: JS ${js.toFixed(2)} ms, Zig ${zg.toFixed(2)} ms`)}
console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);
