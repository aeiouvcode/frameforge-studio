/* FrameForge Core bridge: JS shell <-> Zig/WASM kernels.
   Instantiates a verified, import-free module and marshals typed arrays in and out.
   Callers keep a pure-JS fallback; this file never touches the network itself. */
(function(root){
  'use strict';
  function createFFCore(module){
    const inst=new WebAssembly.Instance(module,{});
    const x=inst.exports;
    if(x.ff_abi_version()!==1)throw Error('FrameForge core ABI mismatch');
    const regions=new Map();
    function region(name,bytes){
      let r=regions.get(name);
      if(r&&r.len>=bytes)return r.ptr;
      if(r)x.ff_free(r.ptr,r.len);
      const len=Math.max(bytes,64);const ptr=x.ff_alloc(len);
      if(!ptr)throw Error('FrameForge core out of memory');
      regions.set(name,{ptr,len});return ptr;
    }
    const u8=()=>new Uint8Array(x.memory.buffer);
    const f32=()=>new Float32Array(x.memory.buffer);
    const u32=()=>new Uint32Array(x.memory.buffer);
    const lutCache=new WeakMap();
    function flatLut(lut){
      let flat=lutCache.get(lut);
      if(!flat){const n=lut.size**3;flat=new Float32Array(n*3);for(let i=0;i<n;i++){const r=lut.data[i];flat[i*3]=r[0];flat[i*3+1]=r[1];flat[i*3+2]=r[2]}lutCache.set(lut,flat)}
      return flat;
    }
    let lastLut=null;
    return {
      kind:'zig-wasm',abi:1,
      lutApply(data,lut){
        const flat=flatLut(lut);
        const lp=region('lut',flat.byteLength),dp=region('dom',24),pp=region('px',data.length);
        if(lastLut!==lut){f32().set(flat,lp>>2);f32().set([...lut.domainMin,...lut.domainMax],dp>>2);lastLut=lut}
        u8().set(data,pp);x.ff_lut_apply(pp,data.length,lp,lut.size,dp);data.set(u8().subarray(pp,pp+data.length));
        return data;
      },
      // Pitch-preserving time-stretch. channels: Float32Array[] (same length). rate = speed.
      wsola(channels,rate,opt={}){
        const n=channels[0].length,hs=opt.hs||256,wl=opt.wl||1024,tol=opt.tol||256,nOut=Math.max(1,Math.floor(n/rate)),nf=Math.ceil(nOut/hs)+1;
        const mono=new Float32Array(n);for(const c of channels)for(let i=0;i<n;i++)mono[i]+=c[i];
        const win=new Float32Array(wl);for(let i=0;i<wl;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/wl);
        const xp=region('wsx',n*4),pp=region('wsp',nf*4),wp=region('wsw',wl*4),op=region('wso',nOut*4),sp=region('wss',nOut*4);
        f32().set(mono,xp>>2);x.ff_wsola_plan(xp,n,rate,hs,wl,tol,pp,nf);f32().set(win,wp>>2);
        const outs=[];for(const c of channels){f32().set(c,xp>>2);x.ff_wsola_ola(xp,n,pp,nf,wp,hs,wl,op,sp,nOut);outs.push(f32().slice(op>>2,(op>>2)+nOut))}
        return outs;
      },
      peaks(samples,bins){
        const sp=region('samples',samples.byteLength),op=region('peaks',bins*4);
        f32().set(samples,sp>>2);x.ff_peaks(sp,samples.length,bins,op);
        return f32().slice(op>>2,(op>>2)+bins);
      },
      lumaHist(data,step){
        const pp=region('scope',data.length),op=region('hist',256);
        u8().set(data,pp);const avg=x.ff_luma_hist(pp,data.length,step,op)/1000;
        return {bins:u32().slice(op>>2,(op>>2)+64),avg};
      },
      composite(dst,dw,dh,src,sw,sh,m,opacity=1,blend=0){
        const [a,b,c,d,e,f]=m,det=a*d-b*c;if(!det)return dst;
        const inv=[d/det,-b/det,-c/det,a/det,(c*f-d*e)/det,(b*e-a*f)/det];
        const xs=[e,a*sw+e,c*sh+e,a*sw+c*sh+e],ys=[f,b*sw+f,d*sh+f,b*sw+d*sh+f];
        const bb=[Math.floor(Math.min(...xs))-1,Math.floor(Math.min(...ys))-1,Math.ceil(Math.max(...xs))+1,Math.ceil(Math.max(...ys))+1];
        const dp=region('cdst',dst.length),sp=region('csrc',src.length),mp=region('cinv',24),bp=region('cbb',16);
        u8().set(dst,dp);u8().set(src,sp);f32().set(inv,mp>>2);new Int32Array(x.memory.buffer).set(bb,bp>>2);
        x.ff_composite(dp,dw,dh,sp,sw,sh,mp,opacity,blend,bp);dst.set(u8().subarray(dp,dp+dst.length));return dst;
      },
      logMel(sig,live,win,cos,sin,filt){
        const sp=region('msig',sig.byteLength),wp=region('mwin',win.byteLength),cp=region('mcos',cos.byteLength),np=region('msin',sin.byteLength),fp=region('mfilt',filt.byteLength),op=region('mout',80*live*4);
        f32().set(sig,sp>>2);f32().set(win,wp>>2);f32().set(cos,cp>>2);f32().set(sin,np>>2);f32().set(filt,fp>>2);
        x.ff_log_mel(sp,live,wp,cp,np,fp,op);return f32().slice(op>>2,(op>>2)+80*live);
      },
      memoryBytes(){return x.memory.buffer.byteLength}
    };
  }
  root.createFFCore=createFFCore;
})(typeof globalThis!=='undefined'?globalThis:this);
