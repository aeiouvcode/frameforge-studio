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
        const n=channels[0].length,hs=opt.hs||256,tol=opt.tol||256,nOut=Math.max(1,Math.floor(n/rate)),nf=Math.ceil(nOut/hs)+1;
        const mono=new Float32Array(n);for(const c of channels)for(let i=0;i<n;i++)mono[i]+=c[i];
        // Adaptive per-frame window: estimate the local period on a 4x-decimated mono mix; sustained low notes get a 2048-sample window, mid 1024, high 512, unvoiced keeps 1024. Must stay identical to the plan inside wsolaJS in index.html.
        const wls=new Uint32Array(nf),wofs=new Uint32Array(nf),wins=new Float32Array(3584);
        for(const w of[512,1024,2048])for(let i=0;i<w;i++)wins[w-512+i]=0.5-0.5*Math.cos(2*Math.PI*i/w);
        const dn=n>>2,dm=new Float32Array(dn);for(let i=0;i<dn;i++)dm[i]=(mono[4*i]+mono[4*i+1]+mono[4*i+2]+mono[4*i+3])*.25;
        wls[0]=opt.fixed||1024;wofs[0]=wls[0]-512;
        for(let k=1;k<nf;k++){let wl=opt.fixed||1024;if(!opt.fixed&&rate>=1&&dn>=384){const nom=Math.round(k*hs*rate),W=256,s0=Math.min(Math.max(0,Math.floor(nom/4)),dn-W);let e0=0;for(let i=0;i<W;i+=2){const v=dm[s0+i];e0+=v*v}if(e0>1e-6*W){let bl=0,bc=0.35;for(let l=12;l<=128;l++){let c=0,e1=0;for(let i=0;i<W;i+=2){const a=dm[s0+i],b=dm[s0+i+l];c+=a*b;e1+=b*b}const r=c/Math.sqrt(e0*e1+1e-12);if(r>bc){bc=r;bl=l}}if(bl){const p=bl*4;wl=p<=160?512:p<=352?1024:2048}}}wls[k]=wl;wofs[k]=wl-512}
        const xp=region('wsx',n*4),pp=region('wsp',nf*4),lp=region('wsl',nf*4),fp2=region('wso2',nf*4),wp=region('wsw',3584*4),op=region('wso',nOut*4),sp=region('wss',nOut*4);
        const nb=Math.ceil(n/hs),fl=new Uint8Array(nb);if(opt.lock!==false){const E=new Float64Array(nb);for(let b=0;b<nb;b++){let e=0;for(let i=b*hs;i<Math.min(n,(b+1)*hs);i++)e+=mono[i]*mono[i];E[b]=e}for(let b=1;b<nb;b++){let m=0,c=0;for(let q=Math.max(0,b-4);q<b;q++){m+=E[q];c++}m/=c;if(E[b]>6*m&&E[b]>1e-4*hs&&!fl[b-1])fl[b]=1}}const lk=opt.lock!==false&&x.ff_wsola_plan_lock;const fp=lk?region('wsf',nb):0;if(lk)u8().set(fl,fp);f32().set(mono,xp>>2);u32().set(wls,lp>>2);u32().set(wofs,fp2>>2);f32().set(wins,wp>>2);
        if(lk)x.ff_wsola_plan_lock(xp,n,rate,hs,tol,pp,nf,fp,nb,lp);else x.ff_wsola_plan(xp,n,rate,hs,tol,pp,nf,lp);
        const outs=[];for(const c of channels){f32().set(c,xp>>2);x.ff_wsola_ola(xp,n,pp,nf,wp,fp2,lp,hs,op,sp,nOut);outs.push(f32().slice(op>>2,(op>>2)+nOut))}
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
