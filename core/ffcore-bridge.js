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
      memoryBytes(){return x.memory.buffer.byteLength}
    };
  }
  root.createFFCore=createFFCore;
})(typeof globalThis!=='undefined'?globalThis:this);
