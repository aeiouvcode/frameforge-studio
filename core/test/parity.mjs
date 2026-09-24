// Parity + benchmark: Zig/WASM core vs the shipping JS kernels extracted from index.html.
import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const grab=n=>{const i=html.indexOf('function '+n+'(');let d=0,j=html.indexOf('{',i);for(;j<html.length;j++){if(html[j]=='{')d++;else if(html[j]=='}'&&--d==0)break}return html.slice(i,j+1)};
// Native-speed JS (no vm context) so the benchmark reflects real V8 JIT behaviour.
const ctx=new Function('ffCore',grab('sampleCube')+grab('applyLutPixels')+grab('parseCube')+';return {sampleCube,applyLutPixels,parseCube}')(null);
new Function(fs.readFileSync(new URL('../ffcore-bridge.js',import.meta.url),'utf8'))();ctx.createFFCore=globalThis.createFFCore;
const core=ctx.createFFCore(new WebAssembly.Module(fs.readFileSync(new URL('../frameforge-core.wasm',import.meta.url))));
const bench=(f,it)=>{f();const t=performance.now();for(let i=0;i<it;i++)f();return (performance.now()-t)/it};let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
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
{const n=48000*180,x=new Float32Array(n);for(let i=0;i<n;i+=997)x[i]=((i*7919)%1000)/1000-.5;const bins=3600,p=core.peaks(x,bins);let bad=0;for(let k=0;k<bins;k++){let m=0;const a=Math.floor(n*k/bins),e=Math.floor(n*(k+1)/bins);for(let j=a;j<e;j++){const v=Math.abs(x[j]);if(v>m)m=v}if(Math.abs(m-p[k])>1e-7)bad++}ok(bad===0,`Waveform peaks exact over a 3-minute signal (${n} samples, ${bins} bins; ${bad} wrong)`)}
// luma histogram vs JS updateScope math
{const W=1280,H=720,d=new Uint8ClampedArray(W*H*4);for(let i=0;i<d.length;i++)d[i]=(rnd()*256)|0;const bins=new Uint32Array(64);let avg=0,c=0;for(let i=0;i<d.length;i+=64){let y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];bins[Math.min(63,y>>2)]++;avg+=y;c++}avg/=c;const z=core.lumaHist(d,16);let bd=0;for(let i=0;i<64;i++)bd+=Math.abs(bins[i]-z.bins[i]);ok(bd<=c*0.001&&Math.abs(avg-z.avg)<0.05,`Luma scope histogram: bin delta ${bd}/${c}, avg ${avg.toFixed(3)} vs ${z.avg.toFixed(3)}`)}
// compositor: Zig vs f64 JS reference of the same straight-alpha bilinear source-over
function refComposite(dst,dw,dh,src,sw,sh,m,op,blend){const [a,b,c,d,e,f]=m,det=a*d-b*c,iv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const fx=x+.5,fy=y+.5,sx=iv[0]*fx+iv[2]*fy+iv[4]-.5,sy=iv[1]*fx+iv[3]*fy+iv[5]-.5;if(sx<=-1||sy<=-1||sx>=sw||sy>=sh)continue;const x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0,acc=[0,0,0,0];for(let k=0;k<4;k++){const ox=k&1,oy=k>>1&1,w0=(ox?tx:1-tx)*(oy?ty:1-ty),px=x0+ox,py=y0+oy;if(px<0||py<0||px>=sw||py>=sh)continue;const si=(py*sw+px)*4,w=w0*src[si+3]/255;acc[0]+=src[si]*w;acc[1]+=src[si+1]*w;acc[2]+=src[si+2]*w;acc[3]+=w}if(acc[3]<=0)continue;const A=acc[3]*op,di=(y*dw+x)*4,da=dst[di+3]/255,oa=A+da*(1-A);for(let ch=0;ch<3;ch++){const s=acc[ch]/acc[3],dd=dst[di+ch],mx=blend===1?255-(255-s)*(255-dd)/255:blend===2?s*dd/255:blend===3?Math.min(255,s+dd):s,sc=mx*da+s*(1-da);dst[di+ch]=Math.floor(Math.min(255,Math.max(0,(sc*A+dd*da*(1-A))/oa))+.5)}dst[di+3]=Math.floor(Math.min(255,Math.max(0,oa*255))+.5)}return dst}
{const dw=320,dh=180,sw=200,sh=120;const src=new Uint8ClampedArray(sw*sh*4);for(let i=0;i<src.length;i++)src[i]=(rnd()*256)|0;const base=new Uint8ClampedArray(dw*dh*4);for(let i=0;i<base.length;i++)base[i]=i%4===3?255:(rnd()*256)|0;
 const cases=[['identity',[1,0,0,1,40,20],1,0],['scale+rotate',[Math.cos(.4)*1.3,Math.sin(.4)*1.3,-Math.sin(.4)*1.3,Math.cos(.4)*1.3,120,-10],.8,0],['screen',[0.7,0,0,0.7,10,30],.9,1],['multiply',[1.1,0,0,1.1,-20,-5],1,2],['add',[1,0.1,0,1,60,40],.5,3]];
 for(const [name,m,op,bl] of cases){const a=refComposite(new Uint8ClampedArray(base),dw,dh,src,sw,sh,m,op,bl),z=core.composite(new Uint8ClampedArray(base),dw,dh,src,sw,sh,m,op,bl);let mx=0,n=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-z[i]);if(d){n++;mx=Math.max(mx,d)}}ok(mx<=1&&n/a.length<0.01,`Composite ${name}: max diff ${mx}, differing ${(n/a.length*100).toFixed(3)}%`)}
 {const dw2=1920,dh2=1080,s2=new Uint8ClampedArray(dw2*dh2*4).map((_,i)=>i%4===3?255:(i*37)&255),b2=new Uint8ClampedArray(dw2*dh2*4).fill(255),m=[Math.cos(.1),Math.sin(.1),-Math.sin(.1),Math.cos(.1),30,-40];const js=bench(()=>refComposite(new Uint8ClampedArray(b2),dw2,dh2,s2,dw2,dh2,m,.8,0),2),zg=bench(()=>core.composite(new Uint8ClampedArray(b2),dw2,dh2,s2,dw2,dh2,m,.8,0),4);console.log(`BENCH composite 1080p opaque video layer, rotated, 80% opacity: JS ${js.toFixed(1)} ms, Zig ${zg.toFixed(1)} ms, ${(js/zg).toFixed(1)}x`)}}
// security: no imports
ok(WebAssembly.Module.imports(new WebAssembly.Module(fs.readFileSync(new URL('../frameforge-core.wasm',import.meta.url)))).length===0,'Core module has zero imports (no host/network capability)');
// benchmark

for(const [W,H] of [[480,270],[1920,1080]]){const lut=ctx.parseCube(cube(33));const px=new Uint8ClampedArray(W*H*4);for(let i=0;i<px.length;i++)px[i]=(rnd()*256)|0;
  const it=W>1000?2:10;const js=bench(()=>ctx.applyLutPixels({data:new Uint8ClampedArray(px)},lut),it),zg=bench(()=>core.lutApply(new Uint8ClampedArray(px),lut),it);
  console.log(`BENCH LUT ${W}x${H}: JS ${js.toFixed(2)} ms, Zig ${zg.toFixed(2)} ms, ${(js/zg).toFixed(1)}x`)}
{const d=new Uint8ClampedArray(1920*1080*4);for(let i=0;i<d.length;i++)d[i]=(rnd()*256)|0;const js=bench(()=>{const b=new Uint32Array(64);let a=0;for(let i=0;i<d.length;i+=16){let y=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];b[Math.min(63,y>>2)]++;a+=y}},20),zg=bench(()=>core.lumaHist(d,4),20);console.log(`BENCH scope 1080p full-res: JS ${js.toFixed(2)} ms, Zig ${zg.toFixed(2)} ms`)}
// speech front end: Zig log-mel vs the JS reference in ff-whisper.js
{globalThis.window=globalThis;new Function(fs.readFileSync(new URL('../ff-whisper.js',import.meta.url),'utf8'))();const W=globalThis.ffWhisper;const n=16000*9,pcm=new Float32Array(n);for(let i=0;i<n;i++)pcm[i]=.4*Math.sin(i*2*Math.PI*220/16000)*Math.sin(i/9000)+.2*Math.sin(i*2*Math.PI*1375/16000)+(rnd()-.5)*.05;
 W.useCore(null);const t0=performance.now(),a=W.logMel(pcm,{js:true}),tj=performance.now()-t0;W.useCore(core);const t1=performance.now(),b=W.logMel(pcm),tz=performance.now()-t1;let mx=0;for(let i=0;i<a.length;i++)mx=Math.max(mx,Math.abs(a[i]-b[i]));
 ok(W.kernel==='zig'&&mx<1e-3,`Speech log-mel 80x3000: max abs diff ${mx.toExponential(2)} (normalised units)`);console.log(`BENCH log-mel 9 s audio: JS ${tj.toFixed(0)} ms, Zig ${tz.toFixed(0)} ms, ${(tj/tz).toFixed(1)}x`)}
console.log(fails?`${fails} FAILED`:'ALL PASS');process.exit(fails?1:0);
