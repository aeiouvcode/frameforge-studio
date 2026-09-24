// Real-sample WSOLA regression: parity, transient timing on real drums, and
// event integrity on real speech. Fixtures in ./fixtures (see ATTRIBUTION.md).
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const src=html.match(/function wsolaJS\([\s\S]*?\}\)\}/)[0];
const wsolaJS=new Function(src+';return wsolaJS')();
new Function(fs.readFileSync(new URL('../ffcore-bridge.js',import.meta.url),'utf8'))();
const core=globalThis.createFFCore(new WebAssembly.Module(fs.readFileSync(new URL('../frameforge-core.wasm',import.meta.url))));
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
function readWav(p){const b=fs.readFileSync(p);const n=b.readUInt32LE(22)*b.readUInt32LE(24)/2|0;
  const sr=b.readUInt32LE(24);const ch=b.readUInt16LE(22);const out=new Float32Array((b.length-44)/2/ch|0);
  for(let i=0;i<out.length;i++)out[i]=b.readInt16LE(44+i*2*ch)/32768;return{x:out,sr:b.readUInt32LE(24)}}
// energy-spike onset detector, same style as the app's transient flags
function onsets(x,sr,hs=256){const nb=Math.ceil(x.length/hs),E=new Float64Array(nb);
  for(let b=0;b<nb;b++){let e=0;for(let i=b*hs;i<Math.min(x.length,(b+1)*hs);i++)e+=x[i]*x[i];E[b]=e}
  const o=[];for(let b=2;b<nb;b++){let m=0;for(let q=Math.max(0,b-4);q<b;q++)m+=E[q];m/=Math.min(4,b);
  if(E[b]>5*m&&E[b]>1e-3*hs&&(!o.length||b-o[o.length-1]>4))o.push(b)}
  return o.map(b=>b*hs/sr)}
// spectral flux peak count (phoneme/syllable-scale events)
function fluxPeaks(x,sr){const W=1024,H=512,nf=Math.floor((x.length-W)/H);let prev=null;const F=[];
  for(let k=0;k<nf;k++){const mag=[];for(let f=1;f<64;f++){let re=0,im=0;for(let i=0;i<W;i+=4){const ph=2*Math.PI*f*i/W;re+=x[k*H+i]*Math.cos(ph);im-=x[k*H+i]*Math.sin(ph)}mag.push(Math.hypot(re,im))}
    let fl=0;if(prev)for(let f=0;f<63;f++)fl+=Math.max(0,mag[f]-prev[f]);F.push(fl);prev=mag}
  let peaks=0;for(let k=2;k<F.length-2;k++)if(F[k]>F[k-1]&&F[k]>=F[k+1]&&F[k]>0.15*Math.max(...F))peaks++;
  return peaks}
const drums=readWav(new URL('fixtures/drum-loop.wav',import.meta.url).pathname);
const speech=readWav(new URL('fixtures/speech.wav',import.meta.url).pathname);
console.log(`fixtures: drums ${(drums.x.length/drums.sr).toFixed(1)}s, speech ${(speech.x.length/speech.sr).toFixed(1)}s @ ${drums.sr}Hz`);

// 1. drums: parity + transient timing at 1.5x and 0.75x
for(const r of [1.5,0.75]){
  const a=core.wsola([drums.x,drums.x],r),b=wsolaJS([drums.x,drums.x],r);
  let m=0;for(let i=0;i<a[0].length;i++)m=Math.max(m,Math.abs(a[0][i]-b[0][i]));
  const o0=onsets(drums.x,drums.sr),o1=onsets(a[0],drums.sr);
  const errs=o0.map(t=>{const want=t/r;let best=1e9;for(const u of o1)best=Math.min(best,Math.abs(u-want));return best*1000});
  errs.sort((p,q)=>p-q);const med=errs[errs.length>>1]||0,worst=errs.at(-1)||0;
  ok(m<1e-6&&med<15&&Math.abs(o1.length-o0.length)<=1,
    `Drums ${r}x: parity ${m.toExponential(1)}, ${o0.length} onsets -> ${o1.length}, median timing error ${med.toFixed(1)}ms, worst ${worst.toFixed(1)}ms`)}

// 2. speech: parity + pan-free event integrity at 1.5x and 0.75x
for(const r of [1.5,0.75]){
  const a=core.wsola([speech.x,speech.x],r),b=wsolaJS([speech.x,speech.x],r);
  let m=0;for(let i=0;i<a[0].length;i++)m=Math.max(m,Math.abs(a[0][i]-b[0][i]));
  const dur0=speech.x.length/speech.sr,dur1=a[0].length/speech.sr;
  const f0=fluxPeaks(speech.x,speech.sr)/dur0,f1=fluxPeaks(a[0],speech.sr)/dur1,fOld=fluxPeaks(wsolaJS([speech.x,speech.x],r,{fixed:1024})[0],speech.sr)/dur1;
  const ratio=f1/f0,ratioOld=fOld/f0;
  const reg=Math.abs(ratio-1)<=Math.abs(ratioOld-1)+0.05;
  ok(m<1e-6&&Math.abs(ratio-1)<0.15&&reg,
    `Speech ${r}x: parity ${m.toExponential(1)}, flux events/s ${f0.toFixed(1)} -> ${f1.toFixed(1)} (${(ratio*100).toFixed(0)}% of original rate; fixed-window: ${(ratioOld*100).toFixed(0)}%)`)

}

if(fails){console.log(fails+' FAILED');process.exit(1)}console.log('ALL REAL-AUDIO PASS');
