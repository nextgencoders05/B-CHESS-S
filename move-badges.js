/* Independent UCI worker: no changes to the gameplay engine or clock paths. */
(function(){
 'use strict';
 const definitions={brilliant:['!!','Brilliant'],great:['!','Great Move'],best:['★','Best'],excellent:['◆','Excellent'],good:['✓','Good'],inaccuracy:['?!','Inaccuracy'],mistake:['?','Mistake'],blunder:['??','Blunder']};
 const slots=new Map(),cache=new Map();let chain=Promise.resolve(),worker=null,ready=null;
 const competitive=()=>!!((currentRoomCode&&!friendRoomData?.gameOver)||(isOnlineMatchActive&&!quickBot?.over)||window.bchessTournamentActive);
 async function engine(){
  if(worker)return worker;if(ready)return ready;
  ready=(async()=>{
   let script;for(const url of ['https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js','https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js']){try{const r=await fetch(url);if(r.ok){script=await r.text();break;}}catch(_){}}
   if(!script)throw new Error('Analysis engine unavailable');const url=URL.createObjectURL(new Blob([script],{type:'application/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{w.terminate();reject(new Error('Engine startup timed out'));},10000);w.onmessage=e=>{if(String(e.data)==='uciok'){clearTimeout(timer);resolve();}};w.onerror=()=>{clearTimeout(timer);reject(new Error('Analysis engine failed'));};w.postMessage('uci');});
   w.postMessage('setoption name Hash value 16');w.postMessage('setoption name MultiPV value 2');worker=w;return w;
  })();try{return await ready;}finally{ready=null;}
 }
 async function evaluate(fen){
  if(cache.has(fen))return cache.get(fen);
  const c=new Chess(fen);if(c.game_over())return {score:c.in_checkmate()?-100000:0,pv:[],second:null};
  const w=await engine();const result=await new Promise((resolve,reject)=>{
   let lines={};const timer=setTimeout(()=>{w.terminate();worker=null;reject(new Error('Analysis timed out'));},8000);
   w.onmessage=e=>{const line=String(e.data);const score=line.match(/score (cp|mate) (-?\d+)/),pv=line.match(/\bpv (.+)/),depth=line.match(/\bdepth (\d+)/),rank=Number(line.match(/multipv (\d+)/)?.[1]||1);
    if(score&&pv&&!/lowerbound|upperbound/.test(line)){const value=score[1]==='mate'?(Number(score[2])>0?100000:-100000):Number(score[2]);lines[rank]={score:value,pv:pv[1].split(' '),depth:Number(depth?.[1]||0)};}
    if(line.startsWith('bestmove')){clearTimeout(timer);if(!lines[1])reject(new Error('Engine returned no evaluation'));else resolve({...lines[1],second:lines[2]?.score??null});}
   };w.onerror=()=>{clearTimeout(timer);w.terminate();worker=null;reject(new Error('Engine error'));};
   w.postMessage('position fen '+fen);w.postMessage('go depth 14 movetime 900');
  });if(cache.size>200)cache.clear();cache.set(fen,result);return result;
 }
 function classify(before,after,move,afterFen){
  const uci=move.from+move.to+(move.promotion||''),best=before.pv[0]===uci;
  // Do not penalize the engine's own top move for horizon changes between searches.
  const loss=best?0:Math.max(0,before.score+after.score);
  const values={p:100,n:320,b:330,r:500,q:900,k:20000};let sacrifice=false;
  if(after.pv[0]){const c=new Chess(afterFen),r=after.pv[0];const reply=c.move({from:r.slice(0,2),to:r.slice(2,4),promotion:r[4]||'q'});sacrifice=!!(reply?.captured && reply.to===move.to && values[reply.captured]>(values[move.captured]||0)+100);}
  if(best&&loss<=20&&sacrifice&&before.score<500&&-after.score>=-50&&(before.depth||0)>=12&&(after.depth||0)>=12)return {quality:'brilliant',loss};
  if(best&&loss<=20&&(before.depth||0)>=12&&(after.depth||0)>=12&&before.second!==null&&before.score-before.second>=150&&before.second< -50&&before.score>=-50)return {quality:'great',loss};
  return {quality:loss>=200?'blunder':loss>=90?'mistake':loss>=40?'inaccuracy':best&&loss<=10?'best':loss<=20?'excellent':'good',loss};
 }
 function feedback(id){let el=document.getElementById(id+'Quality');if(id==='puzzleBoard')el=document.getElementById('puzzleQuality');if(!el){el=document.createElement('div');el.id=id+'Quality';el.className='quality-feedback';el.setAttribute('aria-live','polite');document.getElementById(id)?.after(el);}return el;}
 function clear(id){slots.delete(id);document.querySelectorAll('#'+id+' .quality-3d').forEach(e=>e.remove());const el=document.getElementById(id==='puzzleBoard'?'puzzleQuality':id+'Quality');if(el)el.textContent='';}
 function paint(id,slot){if(competitive()||slots.get(id)!==slot||!slot.valid())return;const [symbol,label]=definitions[slot.quality];const square=document.querySelector('#'+id+' [data-square="'+slot.move.to+'"]');if(!square)return;
  square.querySelectorAll('.quality-3d').forEach(e=>e.remove());const badge=document.createElement('span');badge.className='quality-3d quality-'+slot.quality;badge.textContent=symbol;badge.setAttribute('aria-hidden','true');square.append(badge);feedback(id).textContent=symbol+' '+label;
 }
 function inspect(id,beforeFen,move,afterFen,valid=()=>true,onResult){
  clear(id);if(competitive())return;const slot={afterFen,move,valid};slots.set(id,slot);feedback(id).textContent='Analyzing move…';
  chain=chain.catch(()=>{}).then(async()=>{
   if(slots.get(id)!==slot||!valid()||competitive())return;
   try{const before=await evaluate(beforeFen);if(slots.get(id)!==slot||!valid()||competitive())return;const after=await evaluate(afterFen);
    if(slots.get(id)!==slot||!valid()||competitive())return;const result=classify(before,after,move,afterFen);Object.assign(slot,result);paint(id,slot);onResult?.(result);
   }catch(e){if(slots.get(id)===slot&&valid())feedback(id).textContent=e.message+' — no move rating available.';}
  });
 }
 // Board libraries rebuild square contents on flip; restore only a still-current result.
 function init(){for(const id of ['myBoard','reviewBoard','puzzleBoard']){const node=document.getElementById(id);if(!node)continue;new MutationObserver(()=>{const s=slots.get(id);if(s?.quality&&!node.querySelector('.quality-3d'))paint(id,s);}).observe(node,{childList:true,subtree:true});}}
 window.BChessBadges={inspect,clear,position:id=>slots.get(id)?.afterFen,classify,definitions};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
