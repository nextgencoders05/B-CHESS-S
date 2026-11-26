const {fixture}=require('./interactions.cjs');const assert=require('assert');
(async()=>{
 const t=await fixture(360),{w,clock}=t,$=id=>w.document.getElementById(id),click=id=>$(id).click();
 assert.equal(w.document.querySelector('.brand h1')?.textContent||w.document.querySelector('h1').textContent,'B Chess');
 click('userProfile');assert.equal($('profileModal').style.display,'flex');assert($('profileModal').contains($('signOutBtn')));assert($('profileCurrentRating').textContent.includes('1370'));w.closeProfileModal();
 click('mobileMoreBtn');assert(!$('mobileMorePanel').hidden);assert.equal($('mobileMorePanel').textContent,'Modes');
 const start='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
 let puzzles=[{id:'one',stage:1,fen:start,solution:['e2e4'],batch_id:'batch'},{id:'two',stage:2,fen:start,solution:['d2d4'],batch_id:'batch'}],hints=3,seen=new Set(),deletes=[];
 w.sbCall=async(n,a)=>{
  if(n==='get_puzzle_stages')return {puzzles,completed:[]};if(n==='puzzle_hint_status')return {remaining:hints};
  if(n==='puzzle_hint'){const key=a.p_attempt+':'+a.p_ply;if(!seen.has(key)){hints--;seen.add(key);}return {remaining:hints,source:'e2'};}
  if(n==='admin_puzzle_list')return puzzles;
  if(n==='admin_delete_puzzles'){deletes.push(a);puzzles=a.p_batch?[]:puzzles.filter(p=>!a.p_ids.includes(p.id)).map((p,i)=>({...p,stage:i+1}));return {};}
  if(n==='tournament_list')return [];return {status:'cancelled'};
 };
 click('modePuzzlesBtn');await clock.tickAsync(0);assert($('puzzleTurn').textContent.includes('White to move'));click('puzzleHintBtn');await clock.tickAsync(0);assert.equal(hints,2);assert(w.document.querySelector('#puzzleBoard [data-square="e2"]').classList.contains('puzzle-hint-square'));click('puzzleHintBtn');await clock.tickAsync(0);assert.equal(hints,2);
 w.document.dispatchEvent(new w.Event('bchess-admin-open'));await clock.tickAsync(0);assert.equal(w.document.querySelectorAll('.admin-puzzle-card').length,2);
 w.document.querySelector('.admin-puzzle-card button').click();await clock.tickAsync(0);assert.equal(deletes.length,1);assert($('puzzleStatus').textContent.includes('deleted'));assert($('puzzleStages').textContent.includes('Stage 1'));
 w.document.querySelector('#adminPuzzleBatches button').click();await clock.tickAsync(0);assert.equal(deletes[1].p_batch,'batch');assert.equal(puzzles.length,0);
 puzzles=[{id:'black',stage:1,fen:'7k/8/8/8/8/8/4K3/8 b - - 0 1',solution:['h8g7']}];w.closePuzzleMode();click('modePuzzlesBtn');await clock.tickAsync(0);assert($('puzzleTurn').textContent.includes('Black to move'));
 w.closePuzzleMode();click('modeAnalyzeBtn');$('analysisPGNInput').value='1. e4 e5 2. Nf3 *';click('analysisPGNLoad');assert.equal($('matchReviewModal').style.display,'flex');assert.equal(w.eval('reviewSans.length'),3);assert($('reviewBoardQuality').textContent.includes('Analyzing'));await clock.tickAsync(0);
 $('analysisPGNInput').value='1. e5';click('analysisPGNLoad');assert($('analysisPGNError').textContent.includes('valid PGN'));
 const incomplete=new w.File(['not png'],'wk.png',{type:'image/png'});Object.defineProperty($('adminThemeFiles'),'files',{value:[incomplete],configurable:true});$('adminThemeKind').value='coins';$('adminThemeFiles').dispatchEvent(new w.Event('change'));await clock.tickAsync(0);assert($('adminThemeStatus').textContent.includes('exactly 12'));assert($('adminThemePublish').disabled);
 // Published assets dynamically become choices; applying either must preserve the active board.
 const coins=Object.fromEntries(['wk','wq','wr','wb','wn','wp','bk','bq','br','bb','bn','bp'].map(k=>[k,'c/'+k+'.png']));
 w.sb.storage={from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://assets.invalid/'+path}})})};
 w.sb.from=()=>({select(){return this},order:async()=>({data:[{id:'b',kind:'board',name:'Textures',assets:{light:'b/light.png',dark:'b/dark.png'}},{id:'c',kind:'coins',name:'Coins',assets:coins}]})});
 await w.BChessThemes.refresh();w.eval("game.move('d4');board.position(game.fen());board.orientation('black');");const fen=w.eval('game.fen()');
 w.document.querySelector('[data-board="b"]').click();w.document.querySelector('[data-coins="c"]').click();assert.equal(w.localStorage.getItem('bChessBoard'),'b');assert.equal(w.localStorage.getItem('bChessCoins'),'c');assert.equal(w.eval('game.fen()'),fen);assert.equal(w.eval('board.orientation()'),'black');assert.equal(w.eval('game.history().length'),1);
 // Classification thresholds are deterministic; correct moves are not automatically brilliant.
 const c=new w.Chess(),before=c.fen(),move=c.move('e4'),after=c.fen(),classify=w.BChessBadges.classify;
 assert.equal(classify({score:30,pv:['e2e4'],second:0},{score:-30,pv:[]},move,after).quality,'best');
 assert.equal(classify({score:30,pv:['d2d4'],second:0},{score:180,pv:[]},move,after).quality,'blunder');
 assert.equal(classify({score:30,pv:['e2e4'],second:-150,depth:14},{score:-30,pv:[],depth:14},move,after).quality,'great');
 // A controlled UCI worker validates asynchronous rendering/staleness (not real engine accuracy).
 class Worker {postMessage(cmd){if(cmd==='uci')Promise.resolve().then(()=>{this.onmessage({data:'id name Stockfish 18 Lite'});this.onmessage({data:'uciok'});});if(cmd.startsWith('go '))w.setTimeout(()=>{this.onmessage({data:'info depth 14 multipv 1 score cp 0 pv e2e4'});this.onmessage({data:'bestmove e2e4'});},50);}terminate(){}}
 w.Worker=Worker;w.fetch=async()=>({ok:true,text:async()=>'mock UCI'});w.BChessBadges.clear('reviewBoard');w.eval('board.position(game.fen(),false)');
 let valid=true;w.BChessBadges.inspect('myBoard',before,move,after,()=>valid);valid=false;await clock.tickAsync(200);assert(!w.document.querySelector('#myBoard .quality-3d'));
 valid=true;w.BChessBadges.inspect('myBoard',before,move,after,()=>valid);await clock.tickAsync(1200);assert(w.document.querySelector('#myBoard [data-square="e4"] .quality-best'),$('myBoardQuality')?.textContent);w.eval("board.orientation('white')");await clock.tickAsync(0);assert(w.document.querySelector('#myBoard [data-square="e4"] .quality-best'));
 w.bchessTournamentActive=true;w.BChessBadges.inspect('myBoard',before,move,after);assert(!w.document.querySelector('#myBoard .quality-3d'));
 assert.deepEqual(t.errors,[]);t.close();
 const tt=await fixture(390),tw=tt.w,td=id=>tw.document.getElementById(id);let registered=false,moveCalls=0;
 const tournament={id:'tour',name:'Blitz',category:'Blitz',base_seconds:180,increment:2,status:'open',registration_opens:new Date(Date.now()-60000).toISOString(),registration_closes:new Date(Date.now()+60000).toISOString(),starts_at:new Date(Date.now()+60000).toISOString()};
 const entry={user_id:'test-user',name:'Test',photo:'',points:0,wins:0,draws:0};
 let tourGame={id:'game',round:1,status:'active',white_id:'test-user',black_id:'other',turn:'w',fen:start,moves:[],version:0,clock_at:new Date().toISOString(),white_left:180,black_left:180};
 tw.sbCall=async(n,a)=>{if(n==='tournament_list')return [{...tournament,players:registered?2:1}];if(n==='tournament_join'){registered=true;return {}};if(n==='tournament_view')return {tournament,entries:registered?[entry]:[],standings:registered?[entry]:[],games:tournament.status==='live'?[tourGame]:[],serverNow:new Date().toISOString()};if(n==='tournament_game_action')return tourGame;return {status:'cancelled'};};
 tw.sb.functions={invoke:async(name,{body})=>{moveCalls++;assert.equal(body.action,'move');const g=new tw.Chess(tourGame.fen),m=g.move(body.move);tourGame={...tourGame,fen:g.fen(),moves:[m.san],version:1,turn:'b',white_left:182};return {data:tourGame}}};
 td('modeTournamentBtn').click();await tt.clock.tickAsync(0);assert(td('tourDetails').textContent.includes('Registration'));td('tourDetails').querySelector('button').click();await tt.clock.tickAsync(0);assert(registered);assert(td('tourLeaderboard').textContent.includes('Test'));
 tournament.status='live';td('modeTournamentBtn').click();await tt.clock.tickAsync(0);assert(!td('tourGamePanel').hidden,td('tourMessage').textContent);assert(tw.bchessTournamentActive);tw.document.querySelector('#tournamentBoard [data-square="e2"]').click();tw.document.querySelector('#tournamentBoard [data-square="e4"]').click();await tt.clock.tickAsync(0);assert.equal(moveCalls,1);assert.equal(td('tourMoves').textContent,'e4');assert(td('tourClocks').textContent.includes('3:02'));assert.deepEqual(tt.errors,[]);tt.close();
 console.log('PASS added DOM interactions: profile, mobile menu, deletion/batches, turn indicators, hints, PGN review, incomplete assets, dynamic themes, classifications/stale UCI, competitive suppression and tournament registration/gameplay transport.');
})().catch(e=>{console.error(e);process.exit(1)});
