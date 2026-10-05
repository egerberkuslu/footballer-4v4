// VAR otomatik tetikleme olcutu testi (shot.mjs --eval ile): kil payi +3/-3 cm incelenir, +9 cm, tac ve direk disi incelenmez
// scripts/run-browser.sh node scripts/shot.mjs shots/x.png --q "blades=2000&fx=0" --wait 9000 --eval "$(tail -n +4 scripts/var-auto.js)"

(async()=>{const V=window.__var,S=window.__shot;const sl=ms=>new Promise(r=>setTimeout(r,ms));V.state.warp=50;V.setAuto('acik');const R=0.11,g=20;const out={};
const waitActive=async(ms)=>{const t0=performance.now();while(!V.state.active&&performance.now()-t0<ms)await sl(50);return V.state.active};
const end=async()=>{if(!V.state.active)return;window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await sl(400);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));const t=performance.now();while(V.state.active&&performance.now()-t<20000)await sl(50)};
const smp=async(n=2)=>{for(let i=0;i<n;i++){const t=V.rec.lastT;const t0=performance.now();while(V.rec.lastT===t&&performance.now()-t0<8000)await sl(20)}};const at=async(x,z,n=2)=>{V.place(x,R,z);await smp(n)};const path=async(pts,z)=>{V.state.case=null;V.state.verdict=null;await at(5,0,3);S.ctl.inFlight=true;S.ctl.flightT=0;for(const x of pts)await at(x,z)};
for(const [n,m] of [['lampard+3cm',0.03],['geri-3cm',-0.03],['rahat+9cm',0.09]]){
  await path([g-0.6,g-0.2,g+R+m,g+R+m-0.15,g-0.5,g-1.2],0.5);
  await smp(4);const a=await waitActive(3000);const v=V.state.verdict;out[n]={vargit:a||!!V.state.case,karar:v&&v.title,cm:v&&+v.cm.toFixed(2),reason:V.state.reason};await end();S.ctl.inFlight=false}
// taç: top taç çizgisini kıl payı geçip döner
V.state.case=null;await at(0,0,3);S.ctl.inFlight=true;S.ctl.flightT=0;await at(0,-12.2);await at(0,-(12.5+R+0.02));await at(0,-12);await at(0,-11.5,6);
out.tac={vargit:V.state.active||!!V.state.case};await end();
// kale çizgisinde direk dışı kıl payı
await path([g-0.5,g+R+0.02,g-0.6],3.4);await smp(4);out.direkDisi={vargit:V.state.active||!!V.state.case};await end();
return out})()
