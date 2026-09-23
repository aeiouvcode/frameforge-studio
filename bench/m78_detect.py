# M78 filler detector (b): steady-voiced segments between Silero dips.
import json, sys, numpy as np, scipy.io.wavfile as wf
H=0.032
def feats(x,sr=16000):
    n=int(H*sr); F=len(x)//n; out=[]
    prev=None
    for i in range(F):
        s=x[max(0,i*n-n//2):i*n+n+n//2].astype(np.float64)
        s=s-s.mean(); e=np.sqrt((s**2).mean())+1e-9
        ac=np.correlate(s,s,'full')[len(s)-1:]; ac/=ac[0]+1e-9
        lo,hi=sr//300,sr//75; k=lo+np.argmax(ac[lo:hi]); clar=ac[k]
        sp=np.abs(np.fft.rfft(s*np.hanning(len(s)),1024)); sp/=sp.sum()+1e-9
        hf=sp[64:].sum()  # energy share above 1 kHz
        flux=0 if prev is None else np.abs(sp-prev).sum(); prev=sp
        out.append((e,clar,sr/k,hf,flux))
    return np.array(out)
res={}
C=json.load(open(sys.argv[1]))
for w in ['30','90','150']:
    sr,x=wf.read(f'tmp-en{w}.wav'); x=x.astype(np.float32); x/=np.abs(x).max()
    f=feats(x); emed=np.median(f[:,0])
    cands=[]
    for a,b in C[w]:
        i,j=int(round(a/H)),int(round(b/H))
        if j-i<6 or j-i>25: continue
        g=f[i+1:j-1]
        if len(g)<4: continue
        voiced=(g[:,1]>0.55)&(g[:,0]>0.15*emed)
        if voiced.mean()<0.85: continue
        p=g[voiced,2]; pstd=np.std(np.log(p))
        score=(pstd<0.06)*1 + (g[:,3].mean()<0.25)*1 + (np.median(g[:,4])<0.6)*1
        cands.append((round(a,3),round(b,3),round(float(pstd),3),round(float(g[:,3].mean()),3),round(float(np.median(g[:,4])),3),score))
    # keep maximal non-overlapping best segments (score 3, longest)
    good=sorted([c for c in cands if c[5]==3],key=lambda c:-(c[1]-c[0])); pick=[]
    for c in good:
        if all(c[1]<=p[0] or c[0]>=p[1] for p in pick): pick.append(c)
    res[w]=sorted(pick)
    print(w,len(cands),sorted(pick))
json.dump(res,open('/tmp/m78-det.json','w'))
