// FrameForge MP4 writer: builds a seekable MP4 (ISO-BMFF) file in memory from
// WebCodecs chunks. One H.264 video track (avc1, avc-format length-prefixed NALs)
// and an optional Opus audio track (Opus sample entry with dOps). Flat layout:
// ftyp, moov, mdat - moov is sized with placeholder stco entries, then rebuilt
// with real offsets (entry count is fixed, so sizes never change).
(function (root) {
  function u8(...a){return Uint8Array.from(a)}
  function u16(n){return u8((n>>8)&255,n&255)}
  function u24(n){return u8((n>>16)&255,(n>>8)&255,n&255)}
  function u32(n){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n>>>0);return b}
  function u64(n){const b=new Uint8Array(8);new DataView(b.buffer).setBigUint64(0,BigInt(n));return b}
  function s16(n){return u16(n&0xffff)}
  function str(s){return new TextEncoder().encode(s)}
  function box(type,...kids){const len=8+kids.reduce((s,k)=>s+k.length,0);const out=new Uint8Array(len);out.set(u32(len),0);out.set(str(type),4);let o=8;for(const k of kids){out.set(k,o);o+=k.length}return out}
  function full(type,ver,flags,...kids){return box(type,u8(ver),u24(flags),...kids)}
  function cat(...parts){const len=parts.reduce((s,p)=>s+p.length,0);const out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}

  function createMP4({width,height,audio}) {
    const vSamples=[], aSamples=[]; // {ts (track timescale units), dur, key, data}
    let avcC=null;
    const VTS=90000, ATS=audio?audio.sampleRate:44100;
    return {
      addVideo(chunk,meta){
        if(meta?.decoderConfig?.description&&!avcC)avcC=new Uint8Array(meta.decoderConfig.description);
        const d=new Uint8Array(chunk.byteLength);chunk.copyTo(d);
        vSamples.push({ts:Math.round(chunk.timestamp*VTS/1e6),dur:Math.round((chunk.duration||0)*VTS/1e6),key:chunk.type==='key',data:d});
      },
      addAudio(chunk){
        const d=new Uint8Array(chunk.byteLength);chunk.copyTo(d);
        aSamples.push({ts:Math.round(chunk.timestamp*ATS/1e6),dur:Math.round((chunk.duration||0)*ATS/1e6),data:d});
      },
      finish(){
        if(!vSamples.length)throw Error('no video frames');
        if(!avcC)throw Error('missing avcC description (encode with avc format)');
        // fill any zero durations from the next sample (last gets the previous delta)
        for(const arr of [vSamples,aSamples]){
          for(let i=0;i<arr.length;i++)if(!arr[i].dur)arr[i].dur=(i+1<arr.length)?arr[i+1].ts-arr[i].ts:(i>0?arr[i].ts-arr[i-1].ts:1);
        }
        const vDur=vSamples.at(-1).ts+vSamples.at(-1).dur;
        const aDur=aSamples.length?aSamples.at(-1).ts+aSamples.at(-1).dur:0;
        const movieDurMs=Math.round(Math.max(vDur/VTS,aDur/ATS)*1000)||1;
        const stts=s=>{const runs=[];for(const q of s){const last=runs.at(-1);if(last&&last[1]===q.dur)last[0]++;else runs.push([1,q.dur])}return box('stts',u8(0),u24(0),u32(runs.length),...runs.flatMap(r=>[u32(r[0]),u32(r[1])]))};
        const stsz=s=>box('stsz',u8(0),u24(0),u32(0),u32(s.length),...s.map(q=>u32(q.data.length)));
        const stsc=s=>box('stsc',u8(0),u24(0),u32(1),u32(1),u32(1),u32(1)); // every sample its own chunk
        const stco=(s,offs)=>box('stco',u8(0),u24(0),u32(s.length),...s.map((q,i)=>u32(offs?offs[i]:0)));
        function buildMoov(vOffs,aOffs){
          const avc1=box('avc1',
            u8(0,0,0,0,0,0),u16(1),u8(...new Array(16).fill(0)),
            u16(width),u16(height),u32(0x00480000),u32(0x00480000),u32(0),
            u16(1),u8(0),u8(...new Array(31).fill(0)),u16(0x18),s16(-1),
            box('avcC',avcC));
          const vStsd=box('stsd',u8(0),u24(0),u32(1),avc1);
          stsdCache=vStsd;
          const vStbl=box('stbl',vStsd,stts(vSamples),stsc(vSamples),stsz(vSamples),
            stco(vSamples,vOffs),
            box('stss',u8(0),u24(0),u32(vSamples.filter(q=>q.key).length),...vSamples.flatMap((q,i)=>q.key?[u32(i+1)]:[])));
          const vTrak=box('trak',
            full('tkhd',0,3,u32(0),u32(0),u32(1),u32(0),u32(Math.round(vDur/VTS*1000)),
              u8(...new Array(8).fill(0)),s16(0),s16(0),s16(0),u8(0,0),
              u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000),
              u32(width<<16),u32(height<<16)),
            box('mdia',
              full('mdhd',0,0,u32(0),u32(0),u32(VTS),u32(vDur),u16(0x55c4),u16(0)),
              full('hdlr',0,0,u32(0),str('vide'),u32(0),u32(0),u32(0),u8(0),
              ),
              box('minf',
                full('vmhd',0,1,u16(0),u16(0),u16(0),u16(0)),
                box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),
                vStbl)));
          const traks=[vTrak];
          if(aSamples.length){
            const dOps=box('dOps',u8(0),u8(audio.channels),u16(312),u32(ATS),s16(0),u8(0));
            const opus=box('Opus',
              u8(0,0,0,0,0,0),u16(1),u8(...new Array(8).fill(0)),
              u16(audio.channels),u16(16),u16(0),u16(0),u32(ATS<<16),
              dOps);
            const aStsd=box('stsd',u8(0),u24(0),u32(1),opus);
            const aStbl=box('stbl',aStsd,stts(aSamples),stsc(aSamples),stsz(aSamples),
              stco(aSamples,aOffs));
            traks.push(box('trak',
              full('tkhd',0,3,u32(0),u32(0),u32(2),u32(0),u32(Math.round(aDur/ATS*1000)),
                u8(...new Array(8).fill(0)),s16(0),s16(0x0100),s16(0),u8(0,0),
                u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000),
                u32(0),u32(0)),
              box('mdia',
                full('mdhd',0,0,u32(0),u32(0),u32(ATS),u32(aDur),u16(0x55c4),u16(0)),
                full('hdlr',0,0,u32(0),str('soun'),u32(0),u32(0),u32(0),u8(0)),
                box('minf',
                  full('smhd',0,0,s16(0),s16(0)),
                  box('dinf',full('dref',0,0,u32(1),full('url ',0,1))),
                  aStbl))));
          }
          return box('moov',
            full('mvhd',0,0,u32(0),u32(0),u32(1000),u32(movieDurMs),
              u32(0x00010000),u16(0x0100),u8(0,0),u8(...new Array(8).fill(0)),
              u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000),
              u8(...new Array(24).fill(0)),u32(3)),
            ...traks);
        }
        const ftyp=box('ftyp',str('isom'),u32(0x200),str('isom'),str('iso6'),str('avc1'),str('mp41'));
        const probe=buildMoov(null,null);
        // real sample offsets: mdat follows moov (moov size is fixed - stco entry count never changes)
        const mdatDataOff=ftyp.length+probe.length+8;
        let off=mdatDataOff;const vOffs=[],aOffs=[];
        for(const q of vSamples){vOffs.push(off);off+=q.data.length}
        for(const q of aSamples){aOffs.push(off);off+=q.data.length}
        const moov=buildMoov(vOffs,aOffs);
        const mdatPayload=cat(...vSamples.map(q=>q.data),...aSamples.map(q=>q.data));
        const mdat=cat(u32(mdatPayload.length+8),str('mdat'),mdatPayload);
        return new Blob([ftyp,moov,mdat],{type:'video/mp4'});
      }
    };
  }
  root.ffMp4={createMP4};
})(typeof self!=='undefined'?self:globalThis);
