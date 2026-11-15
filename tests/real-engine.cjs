// Optional integration check. Supply the existing Stockfish 10.0.2 CDN JS file.
const assert=require('assert'),fs=require('fs'),path=require('path');const {Worker:NodeWorker}=require('worker_threads');const {fixture}=require('./interactions.cjs');
(async()=>{if(!process.env.STOCKFISH_JS)throw new Error('Set STOCKFISH_JS to a downloaded Stockfish 10.0.2 stockfish.js');
 const source=path.resolve(process.env.STOCKFISH_JS),t=await fixture(),workers=[];
 try{t.w.fetch=async()=>({ok:true,text:async()=>fs.readFileSync(source,'utf8')});
 t.w.Worker=class {constructor(){this.worker=new NodeWorker(`const {parentPort}=require('worker_threads');global.postMessage=x=>parentPort.postMessage(x);global.close=()=>process.exit();parentPort.on('message',x=>global.onmessage({data:x}));require(${JSON.stringify(source)});`,{eval:true});workers.push(this.worker);this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}postMessage(x){this.worker.postMessage(x)}terminate(){this.worker.terminate()}};
 const c=new t.w.Chess(),before=c.fen(),move=c.move('e4'),after=c.fen();t.w.eval(`game.load(${JSON.stringify(after)});board.position(game.fen(),false);`);
 let result;t.w.BChessBadges.inspect('myBoard',before,move,after,()=>true,r=>result=r);
 for(let i=0;i<80&&!result;i++)await new Promise(r=>setTimeout(r,100));
 assert(result,'Actual UCI evaluation did not finish: '+t.w.document.getElementById('myBoardQuality')?.textContent);assert(Number.isFinite(result.loss));assert(t.w.document.querySelector('#myBoard [data-square="e4"] .quality-3d'));console.log('PASS actual Stockfish 10.0.2 worker → before/after evaluation → '+result.quality+' badge; loss '+result.loss+' cp.');
 }finally{workers.forEach(w=>w.terminate());t.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
