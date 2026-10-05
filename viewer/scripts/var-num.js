// VAR sayisal karar testi (shot.mjs --eval): cizgi ustu -11 cm GOL DEGIL, +1 cm GOL, -1 cm GOL DEGIL
// scripts/run-browser.sh node scripts/shot.mjs shots/x.png --q "blades=2000&fx=0" --wait 9000 --eval "$(tail -n +4 scripts/var-num.js)"

(async()=>{const V=window.__var,S=window.__shot;const sl=ms=>new Promise(r=>setTimeout(r,ms));V.state.warp=50;const R=0.11,g=20;const out={};
for(const [n,x] of [['cizgi-ustu',g],['1cm-icerde',g+R+0.01],['1cm-disarida',g+R-0.01],['42cm-icerde',g+R+0.42]]){
 V.place(10,R,0);await sl(1500);V.place(x,R,0.4);await sl(2500);V.place(x,R,0.4);await sl(1500);
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'x'}));
 const t0=performance.now();while(!V.state.active&&performance.now()-t0<30000)await sl(50);
 const v=V.state.verdict;out[n]=v&&{t:v.title,cm:+v.cm.toFixed(2),x:v.x};
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await sl(300);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
 const t1=performance.now();while(V.state.active&&performance.now()-t1<30000)await sl(50);out[n].after=[V.state.active,S.world.timeScale,+S.world.ball.x.toFixed(3)];}
return out})()
